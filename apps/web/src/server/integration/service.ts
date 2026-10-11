// The Integration tab's reads and writes (brief S2-05). Server actions (actions.ts) are thin
// wrappers: they check who is asking and what was sent, then call these functions, which take
// everything they need as arguments (the database pool, the tenant, the sealing key, the queue)
// so tests run them against a real Postgres without a signed-in person.
//
// What this file never does:
//   - call barsy or open credentials (the web only seals; the worker opens);
//   - return, log or store a password: it exists in memory until it is sealed, and only the
//     sealed envelope goes to the database;
//   - write the menu document (that stays `apply()`'s); it writes the integration, the barsy
//     venue mapping and the catalogue root through core's writers, and queues jobs.
//
// The venue's integration: the one of the barsy venue mapped to this venue; before any venue is
// mapped, the organisation's first barsy integration; none if it has none. (One installation per
// organisation is all the proof of concept needs; D39.)
import {
  type IntegrationId,
  isLocale,
  JOB_NAMES,
  type JobPayload,
  newId,
  nextSyncRuns,
  type ProducedJobName,
  parseSyncSettings,
  type SyncSettingsInput,
  SyncSettingsInputSchema,
  syncTimeZone,
  type TenantId,
  type VenueId,
} from '@restro/core'
import {
  clearBarsyVenueChoices,
  createIntegration,
  mapBarsyVenue,
  readCachedTree,
  readSyncState,
  saveSyncSettingsConfig,
  setCatalogueRoot,
  setVenuePriceSource,
  updateIntegration,
} from '@restro/core/apply'
import { parseSealPublicKey, SealError, sealBarsyCredentials } from '@restro/core/seal'
import {
  type BarsyVenue,
  barsyVenues,
  type DbPool,
  type Integration,
  integrations,
  type JobRun,
  jobRuns,
  sourceLinks,
  sourceRecords,
  venues,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import {
  absenceHeldOf,
  readHeldSync,
  readVenueHints,
  type VenueHint,
} from '../../connectors/sync-reads'
import { logError } from '../log'
import { syncGate } from './gating'
import { parseBarsyHost } from './host'
import { buildCategoryTree, detectAllergenOption, readDetailOptions, treeHas } from './tree'
import type {
  ActiveJob,
  BarsyVenueOption,
  IntegrationActionResult,
  IntegrationErrorCode,
  IntegrationInfo,
  IntegrationStatus,
  IntegrationView,
  PriceSource,
  RunView,
  SyncSettingsView,
} from './view'

/** Who is asking, for which venue. `canManage` comes from the organisation role, never the request. */
export interface IntegrationScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venue: { readonly id: string; readonly name: string; readonly timezone: string }
  readonly canManage: boolean
}

/** What the writes need from outside the database. */
export interface IntegrationServices {
  /** `SEAL_PUBLIC_KEY`; undefined when the web has none. */
  readonly sealPublicKey: string | undefined
  /** Puts a job in the queue (`enqueueJob`); resolves to null when an identical job is waiting. */
  readonly enqueue: <N extends ProducedJobName>(
    name: N,
    data: JobPayload<N>,
  ) => Promise<string | null>
}

/** How many runs the history shows. */
export const HISTORY_LENGTH = 20
/**
 * Photo downloads write one run per picture; listed among the sync runs they would push every
 * pull out of the latest twenty, so the history leaves them out.
 */
export const HISTORY_EXCLUDED_KINDS = ['asset_fetch'] as const

const DEFAULT_LOCALE = 'bg_BG'
const PRICE_SOURCES: readonly PriceSource[] = ['actual_price', 'current_price']

const fail = (error: IntegrationErrorCode): IntegrationActionResult => ({ ok: false, error })

function pgCode(error: unknown): string | undefined {
  let current: unknown = error
  while (current instanceof Error && current.cause instanceof Error) current = current.cause
  const code = (current as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** Whether the web has a usable sealing key (set, and a valid X25519 public key). */
export function isSealKeyUsable(key: string | undefined): key is string {
  if (key === undefined) return false
  try {
    parseSealPublicKey(key)
    return true
  } catch {
    return false
  }
}

// --- reading ---------------------------------------------------------------------------------

interface State {
  readonly integration: Integration | null
  /** Every barsy venue of the integration. */
  readonly barsyRows: readonly BarsyVenue[]
  /** Names of the organisation's venues, by id (for "used by …"). */
  readonly venueNames: ReadonlyMap<string, string>
  /** The barsy venue mapped to this venue. */
  readonly mapped: BarsyVenue | null
  readonly runs: readonly JobRun[]
  /** The cached `Articledetails_gettree` answer. */
  readonly detailsPayload: unknown
}

async function loadState(scope: IntegrationScope): Promise<State> {
  return withTenant(scope.pool, scope.tenantId, async (tx) => {
    const [mappedRow] = await tx
      .select()
      .from(barsyVenues)
      .where(eq(barsyVenues.venueId, scope.venue.id))
      .limit(1)
    const [integration] = mappedRow
      ? await tx.select().from(integrations).where(eq(integrations.id, mappedRow.integrationId))
      : await tx
          .select()
          .from(integrations)
          .where(eq(integrations.kind, 'barsy'))
          .orderBy(asc(integrations.createdAt), asc(integrations.id))
          .limit(1)
    if (!integration) {
      return {
        integration: null,
        barsyRows: [],
        venueNames: new Map(),
        mapped: null,
        runs: [],
        detailsPayload: null,
      }
    }
    const barsyRows = await tx
      .select()
      .from(barsyVenues)
      .where(eq(barsyVenues.integrationId, integration.id))
      .orderBy(asc(barsyVenues.name), asc(barsyVenues.bid))
    const venueIds = barsyRows.flatMap((row) => (row.venueId === null ? [] : [row.venueId]))
    const venueRows =
      venueIds.length === 0
        ? []
        : await tx
            .select({ id: venues.id, name: venues.name })
            .from(venues)
            .where(inArray(venues.id, venueIds))
    const runs = await tx
      .select()
      .from(jobRuns)
      .where(
        and(eq(jobRuns.integrationId, integration.id), ne(jobRuns.kind, HISTORY_EXCLUDED_KINDS[0])),
      )
      .orderBy(desc(jobRuns.createdAt), desc(jobRuns.id))
      .limit(HISTORY_LENGTH)
    const [details] = await tx
      .select({ payload: sourceRecords.payload })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.integrationId, integration.id),
          eq(sourceRecords.externalType, 'article_details'),
          eq(sourceRecords.externalId, 'tree'),
        ),
      )
      .orderBy(desc(sourceRecords.fetchedAt))
      .limit(1)
    return {
      integration,
      barsyRows,
      venueNames: new Map(venueRows.map((row) => [row.id, row.name])),
      mapped: barsyRows.find((row) => row.venueId === scope.venue.id) ?? null,
      runs,
      detailsPayload: details?.payload ?? null,
    }
  })
}

/**
 * The connection check or full pull of this integration that is queued or running, from
 * pg-boss's job table (the worker owns it). A job table that is not there (the worker has never
 * started against this database) means nothing is waiting.
 */
export async function readActiveJob(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
): Promise<ActiveJob> {
  try {
    const result = await withTenant(pool, tenantId, (tx) =>
      tx.execute(
        sql`select name from pgboss.job
            where name in (${JOB_NAMES.barsyConnect}, ${JOB_NAMES.barsyFullPull})
              and state::text in ('created', 'retry', 'active')
              and data ->> 'integrationId' = ${integrationId}
              and data ->> 'tenantId' = ${tenantId}
            limit 10`,
      ),
    )
    const names = result.rows.map((row) => String(row.name))
    if (names.includes(JOB_NAMES.barsyFullPull)) return 'pull'
    if (names.includes(JOB_NAMES.barsyConnect)) return 'connect'
    return null
  } catch (error) {
    // 42P01 undefined_table, 3F000 invalid_schema_name, 42501 insufficient_privilege.
    const code = pgCode(error)
    if (code === '42P01' || code === '3F000' || code === '42501') return null
    throw error
  }
}

function toRunView(run: JobRun): RunView {
  const details = run.details
  const absenceHeld = absenceHeldOf(details)
  return {
    id: run.id,
    kind: run.kind,
    status: run.status as RunView['status'],
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    counters: run.counters,
    errorSummary: run.errorSummary,
    details:
      details === null
        ? null
        : {
            notes: details.notes,
            refused: details.refused.map((entry) => ({
              fieldKey: entry.fieldKey ?? null,
              code: entry.code,
            })),
            ...(details.deletionCheckSkipped !== undefined
              ? { deletionCheckSkipped: details.deletionCheckSkipped }
              : {}),
            ...(absenceHeld !== null ? { absenceHeld } : {}),
          },
  }
}

function priceSourceOf(value: unknown): PriceSource {
  return value === 'current_price' ? 'current_price' : 'actual_price'
}

/**
 * The sync settings and when the next syncs are planned. Scheduled syncs run for a connected
 * integration whose barsy venue is mapped to this venue and has a catalogue root (the worker's
 * tick lists exactly those); for any other the card names no times.
 */
function syncSettingsViewOf(
  integration: Integration | null,
  mapped: BarsyVenue | null,
  now: Date,
): SyncSettingsView {
  const settings = parseSyncSettings(integration?.config)
  const scheduleActive =
    integration !== null &&
    integration.status === 'connected' &&
    mapped !== null &&
    mapped.catalogueRootCatId !== null
  let nextIncrementalAt: string | null = null
  let nextFullPullAt: string | null = null
  if (scheduleActive) {
    try {
      // One schedule per integration (D73): the daily full read is in the integration's zone.
      const next = nextSyncRuns(
        now,
        syncTimeZone(integration.config),
        settings.schedule,
        readSyncState(integration.config, mapped.bid),
      )
      nextIncrementalAt = next.incremental?.toISOString() ?? null
      nextFullPullAt = next.fullPull?.toISOString() ?? null
    } catch (error) {
      // A time zone the runtime does not know: the card shows the settings and no times.
      logError('integration_next_runs_failed', error)
    }
  }
  return {
    incrementalEnabled: settings.schedule.incremental_enabled,
    incrementalMinutes: settings.schedule.incremental_minutes,
    fullPullEnabled: settings.schedule.full_pull_enabled,
    fullPullTime: settings.schedule.full_pull_time,
    afterSync: settings.publish.after_sync,
    newItems: settings.publish.new_items,
    scheduleActive,
    nextIncrementalAt,
    nextFullPullAt,
  }
}

/** Everything the tab shows, in one read. */
export async function loadIntegrationView(
  scope: IntegrationScope,
  services: Pick<IntegrationServices, 'sealPublicKey'>,
  now: Date = new Date(),
): Promise<IntegrationView> {
  const state = await loadState(scope)
  const { integration, mapped } = state
  const activeJob = integration
    ? await readActiveJob(scope.pool, scope.tenantId, integration.id)
    : null

  const config = integration?.config ?? {}
  const cached = integration && mapped ? readCachedTree(integration.config, mapped.bid) : null
  const detailOptions = readDetailOptions(state.detailsPayload)
  const lastSyncedAt = (() => {
    if (!integration || !mapped) return null
    const sync = readSyncState(integration.config, mapped.bid)
    const moments = [sync.last_full_pull_at, sync.last_incremental_at].filter(
      (moment): moment is string => moment !== undefined,
    )
    return moments.sort().at(-1) ?? null
  })()

  // Hints for the pickers and the held-sync warning, read from what the sync stored. They never
  // choose anything: a venue without a record simply has no hint.
  const { hints, heldSync } = integration
    ? await withTenant(scope.pool, scope.tenantId, async (tx) => ({
        hints: await readVenueHints(tx, integration.id),
        heldSync: await readHeldSync(tx, integration.id),
      }))
    : { hints: new Map<number, VenueHint>(), heldSync: null }
  const suggestedCatId = mapped ? (hints.get(mapped.bid)?.publicCatId ?? null) : null

  const barsyVenueOptions: BarsyVenueOption[] = state.barsyRows.map((row) => {
    const hint = hints.get(row.bid)
    return {
      key: row.bid,
      name: row.name,
      mappedHere: row.venueId === scope.venue.id,
      usedBy:
        row.venueId !== null && row.venueId !== scope.venue.id
          ? (state.venueNames.get(row.venueId) ?? '')
          : null,
      ...(hint?.address ? { address: hint.address } : {}),
      ...(hint?.publicCatId != null ? { publicMenuSetUp: true as const } : {}),
    }
  })

  const info: IntegrationInfo | null = integration
    ? {
        host: integration.host,
        hasCredentials: integration.credentialsSealed !== null,
        status: integration.status as IntegrationStatus,
        statusDetail: integration.statusDetail,
        lastCheckedAt: integration.lastCheckedAt?.toISOString() ?? null,
      }
    : null

  return {
    canManage: scope.canManage,
    sealReady: isSealKeyUsable(services.sealPublicKey),
    timeZone: scope.venue.timezone,
    venueName: scope.venue.name,
    integration: info,
    activeJob,
    barsyVenues: barsyVenueOptions,
    venueMapped: mapped !== null,
    tree: cached ? buildCategoryTree(cached.categories, suggestedCatId) : null,
    treeFetchedAt: cached?.fetched_at ?? null,
    rootCatId: mapped?.catalogueRootCatId ?? null,
    settings: {
      // The price is per venue (D73, CF-16): the venue's own setting, else the integration's.
      priceSource: priceSourceOf(mapped?.priceSource ?? config.price_source),
      allergenKey:
        typeof config.allergen_detail_key === 'string' ? config.allergen_detail_key : null,
      allergenDetected: detectAllergenOption(detailOptions),
      allergenOptions: detailOptions,
      defaultLocale: isLocale(config.default_locale) ? config.default_locale : DEFAULT_LOCALE,
    },
    syncSettings: syncSettingsViewOf(integration, mapped, now),
    lastSyncedAt,
    heldSync,
    gate: syncGate({
      canManage: scope.canManage,
      integration: info ? { hasCredentials: info.hasCredentials, status: info.status } : null,
      venueMapped: mapped !== null,
      rootChosen: mapped?.catalogueRootCatId != null,
      activeJob,
    }),
    runs: state.runs.map(toRunView),
  }
}

// --- writing ---------------------------------------------------------------------------------

/** What the connect form sends. `password` is read once, to seal it; it is never kept or returned. */
export interface ConnectionInput {
  readonly host: string
  readonly user: string
  readonly password: string
}

async function queueConnect(
  scope: IntegrationScope,
  services: IntegrationServices,
  integrationId: string,
): Promise<boolean> {
  try {
    await services.enqueue(JOB_NAMES.barsyConnect, {
      tenantId: scope.tenantId as TenantId,
      integrationId: integrationId as IntegrationId,
    })
    return true
  } catch (error) {
    logError('integration_connect_not_queued', error)
    return false
  }
}

/**
 * Saves the connection: seals `{user, password}` for the worker (bound to this tenant, the
 * integration and the host), writes the integration (creating it the first time), and queues the
 * connection check.
 *
 * Changing the host asks for the credentials again by construction (every save carries them) and
 * is a different installation: its status goes back to `new`, and the cached trees, the sync
 * state and the barsy-venue choices of the old host are forgotten. It is refused
 * (`host_change_blocked`) while the connection holds a menu, since the ids of another
 * installation would land on the old items.
 */
export async function saveConnection(
  scope: IntegrationScope,
  services: IntegrationServices,
  input: ConnectionInput,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const parsed = parseBarsyHost(input.host)
  if (!parsed.ok) return fail('invalid_host')
  const { host } = parsed
  const publicKey = services.sealPublicKey
  if (!isSealKeyUsable(publicKey)) return fail('sync_keys_missing')

  /** Seals for one integration id: the envelope is bound to it, so the id comes first. */
  const sealFor = (integrationId: string): Sealed => {
    try {
      const sealed = sealBarsyCredentials(
        { user: input.user, password: input.password },
        { publicKey, tenantId: scope.tenantId, integrationId, host },
      )
      return { sealed }
    } catch (error) {
      if (error instanceof SealError) {
        return { error: error.code === 'invalid_key' ? 'sync_keys_missing' : 'invalid' }
      }
      throw error
    }
  }

  const { integration: existing } = await loadState(scope)
  if (existing === null) {
    const id = newId('in')
    const first = sealFor(id)
    if ('error' in first) return fail(first.error)
    const created = await createIntegration(scope.pool, scope.tenantId, {
      kind: 'barsy',
      host,
      id,
      credentialsSealed: first.sealed,
    })
    if (created.created) {
      return { ok: true, queued: await queueConnect(scope, services, created.id) }
    }
    // The host exists already (another request got there first): seal for that row and update it.
    return replaceCredentials(scope, services, created.id, host, sealFor, false)
  }

  const hostChanged = existing.host !== host
  if (hostChanged) {
    // Refused before anything is written. The same host with new credentials is not a change.
    if (await integrationHasLinks(scope, existing.id)) return fail('host_change_blocked')
    const [taken] = await withTenant(scope.pool, scope.tenantId, (tx) =>
      tx
        .select({ id: integrations.id })
        .from(integrations)
        .where(and(eq(integrations.kind, 'barsy'), eq(integrations.host, host)))
        .limit(1),
    )
    if (taken && taken.id !== existing.id) return fail('host_in_use')
  }
  return replaceCredentials(scope, services, existing.id, host, sealFor, hostChanged)
}

/**
 * Whether the integration already holds any menu: a link from one of its barsy objects to an item,
 * section or option of ours, in any state. barsy ids are unique only per installation, so another
 * installation's article 11 would land on our old item 11 and keep its photo and copy (B1-F14).
 */
async function integrationHasLinks(scope: IntegrationScope, integrationId: string) {
  const [row] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select({ integrationId: sourceLinks.integrationId })
      .from(sourceLinks)
      .where(eq(sourceLinks.integrationId, integrationId))
      .limit(1),
  )
  return row !== undefined
}

type Sealed = { readonly sealed: string } | { readonly error: IntegrationErrorCode }

async function replaceCredentials(
  scope: IntegrationScope,
  services: IntegrationServices,
  integrationId: string,
  host: string,
  sealFor: (integrationId: string) => Sealed,
  hostChanged: boolean,
): Promise<IntegrationActionResult> {
  const result = sealFor(integrationId)
  if ('error' in result) return fail(result.error)
  // A new host is a new installation: what was chosen and cached for the old one means nothing.
  // Forgotten first, so a failure half way never leaves old choices pointing at the new host.
  if (hostChanged) await clearBarsyVenueChoices(scope.pool, scope.tenantId, integrationId)
  const updated = await updateIntegration(scope.pool, scope.tenantId, integrationId, {
    host,
    credentialsSealed: result.sealed,
    status: 'new',
    statusDetail: null,
    ...(hostChanged ? { config: { catalogue_trees: null, sync: null } } : {}),
  })
  if (!updated) return fail('not_found')
  return { ok: true, queued: await queueConnect(scope, services, integrationId) }
}

/** "Check again": queues the connection check of the venue's integration. */
export async function checkConnection(
  scope: IntegrationScope,
  services: IntegrationServices,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration } = await loadState(scope)
  if (integration === null || integration.credentialsSealed === null) return fail('not_ready')
  const queued = await queueConnect(scope, services, integration.id)
  return queued ? { ok: true, queued } : fail('queue_unavailable')
}

/** Maps a barsy venue of the installation to this venue. */
export async function chooseBarsyVenue(
  scope: IntegrationScope,
  input: { readonly bid: number },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration } = await loadState(scope)
  if (integration === null) return fail('not_found')
  const result = await mapBarsyVenue(
    scope.pool,
    scope.tenantId,
    integration.id,
    input.bid,
    scope.venue.id,
  )
  if (result.ok) return { ok: true }
  return fail(result.error === 'barsy_venue_taken' ? 'barsy_venue_taken' : 'not_found')
}

/** Chooses the category of the mapped barsy venue's public tree that this menu is read from. */
export async function chooseCatalogueRoot(
  scope: IntegrationScope,
  input: { readonly catId: number },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration, mapped } = await loadState(scope)
  if (integration === null || mapped === null) return fail('not_ready')
  const cached = readCachedTree(integration.config, mapped.bid)
  if (cached === null || !treeHas(buildCategoryTree(cached.categories), input.catId)) {
    return fail('invalid')
  }
  const result = await setCatalogueRoot(
    scope.pool,
    scope.tenantId,
    integration.id,
    mapped.bid,
    input.catId,
  )
  return result.ok ? { ok: true } : fail('not_found')
}

/** The mapping settings: price source, allergen characteristic (null = detect), default language. */
export interface MappingSettingsInput {
  readonly priceSource: PriceSource
  readonly allergenKey: string | null
  readonly defaultLocale: string
}

/**
 * Saves the mapping settings; they apply from the next pull. The price is the setting of the
 * venue this card is shown in (D73, CF-16: prices differ per venue), stored on its barsy venue;
 * before a venue is mapped it is the integration's default. The allergen characteristic and the
 * language go into the integration's config (CF-09b moves them to Settings → Integrations).
 */
export async function saveMappingSettings(
  scope: IntegrationScope,
  input: MappingSettingsInput,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  if (!PRICE_SOURCES.includes(input.priceSource) || !isLocale(input.defaultLocale)) {
    return fail('invalid')
  }
  const state = await loadState(scope)
  if (state.integration === null) return fail('not_found')
  if (
    input.allergenKey !== null &&
    !readDetailOptions(state.detailsPayload).some((option) => option.key === input.allergenKey)
  ) {
    return fail('invalid')
  }
  const { mapped } = state
  if (mapped !== null) {
    const stored = await setVenuePriceSource(
      scope.pool,
      scope.tenantId,
      state.integration.id,
      mapped.bid,
      input.priceSource,
    )
    if (!stored) return fail('not_found')
  }
  const updated = await updateIntegration(scope.pool, scope.tenantId, state.integration.id, {
    config: {
      ...(mapped === null ? { price_source: input.priceSource } : {}),
      // null removes the key: the sync detects the characteristic by its name again.
      allergen_detail_key: input.allergenKey,
      default_locale: input.defaultLocale,
    },
  })
  return updated ? { ok: true } : fail('not_found')
}

/**
 * Saves the sync settings (D59): when barsy is read and whether a sync goes live by itself. They
 * are stored in the integration's config (`schedule` and `publish`), and the worker's next tick
 * follows them. The flat key `publish_after_sync` of S3-01b is removed: `publish.after_sync` says
 * it now.
 *
 * One atomic write (`saveSyncSettingsConfig`) that never reads or writes `publish.auto_paused`:
 * that flag is the pause a return to an older version sets (Publish tab, S3-05) and a manual
 * publish clears, and a rollback or publish that lands while the form is being saved must win.
 */
export async function saveSyncSettings(
  scope: IntegrationScope,
  input: SyncSettingsInput,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const parsed = SyncSettingsInputSchema.safeParse(input)
  if (!parsed.success) return fail('invalid')
  const state = await loadState(scope)
  if (state.integration === null) return fail('not_found')
  const updated = await saveSyncSettingsConfig(
    scope.pool,
    scope.tenantId,
    state.integration.id,
    parsed.data,
  )
  return updated ? { ok: true } : fail('not_found')
}

/** "Sync now": queues a full pull of this venue, if the gate is open. */
export async function syncNow(
  scope: IntegrationScope,
  services: IntegrationServices,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const state = await loadState(scope)
  const { integration, mapped } = state
  if (integration === null) return fail('not_ready')
  const activeJob = await readActiveJob(scope.pool, scope.tenantId, integration.id)
  const gate = syncGate({
    canManage: scope.canManage,
    integration: {
      hasCredentials: integration.credentialsSealed !== null,
      status: integration.status as IntegrationStatus,
    },
    venueMapped: mapped !== null,
    rootChosen: mapped?.catalogueRootCatId != null,
    activeJob,
  })
  if (!gate.enabled) return fail(gate.reason === 'busy' ? 'already_running' : 'not_ready')
  try {
    const id = await services.enqueue(JOB_NAMES.barsyFullPull, {
      tenantId: scope.tenantId as TenantId,
      integrationId: integration.id as IntegrationId,
      venueId: scope.venue.id as VenueId,
    })
    return id === null ? fail('already_running') : { ok: true }
  } catch (error) {
    logError('integration_sync_not_queued', error)
    return fail('queue_unavailable')
  }
}
