// Settings -> Integrations and the venue's Menu source card: their reads and writes (briefs S2-05
// and CF-09b, D73). Server actions (actions.ts) are thin wrappers: they check who is asking and
// what was sent, then call these functions, which take everything they need as arguments (the
// database pool, the tenant, the sealing key, the queue) so tests run them against a real Postgres
// without a signed-in person.
//
// What this file never does:
//   - call the till or open credentials (the web only seals; the worker opens);
//   - return, log or store a password: it exists in memory until it is sealed, and only the
//     sealed envelope goes to the database;
//   - write the menu document (that stays `apply()`'s); it writes the integration, the venue
//     links and the catalogue root through core's writers, and queues jobs.
//
// The organisation's integration: its first till connection (one installation per organisation is
// all the proof of concept needs; D39). Two scopes: `IntegrationScope` is the organisation (the
// Settings page), `VenueScope` adds the venue whose card it is.
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
  addVenueFromTillVenue,
  clearBarsyVenueChoices,
  createIntegration,
  mapBarsyVenue,
  ProvisionError,
  readCachedTree,
  readNotUsedVenues,
  readSyncState,
  saveSyncSettingsConfig,
  setCatalogueRoot,
  setTillVenueNotUsed,
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
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'

import {
  absenceHeldOf,
  type HeldSyncEntry,
  readHeldSyncs,
  readVenueHints,
  type VenueHint,
} from '../../connectors/sync-reads'
import { suggestSlug } from '../../lib/slug'
import { logError } from '../log'
import { syncAllGate, syncGate } from './gating'
import { parseBarsyHost } from './host'
import { buildCategoryTree, detectAllergenOption, readDetailOptions, treeHas } from './tree'
import type {
  ActiveJob,
  HeldSync,
  HeldSyncOfVenue,
  IntegrationActionResult,
  IntegrationErrorCode,
  IntegrationInfo,
  IntegrationStatus,
  IntegrationView,
  LinkedMenuSource,
  MenuSourceView,
  PriceSource,
  RunView,
  SyncSettingsView,
  TillVenueOption,
  TillVenueRow,
  VenueRef,
} from './view'

/** Who is asking, for the organisation. `canManage` comes from the organisation role, never the request. */
export interface IntegrationScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly canManage: boolean
}

/** Who is asking, for one venue's card. */
export interface VenueScope extends IntegrationScope {
  readonly venue: { readonly id: string; readonly name: string; readonly timezone: string }
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
/** The longest venue name "Add as venue" makes (the New venue dialog's limit). */
const MAX_VENUE_NAME_LENGTH = 120

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
  /** Every venue of the installation, by name. */
  readonly tillRows: readonly BarsyVenue[]
  /** Every venue of the organisation, by name. */
  readonly venues: readonly VenueRef[]
}

/**
 * The organisation's integration and its venues. With a `venueId` the integration is the one the
 * venue's till venue belongs to, else the organisation's first.
 */
async function loadState(scope: IntegrationScope, venueId?: string): Promise<State> {
  return withTenant(scope.pool, scope.tenantId, async (tx) => {
    const venueRows = await tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .orderBy(asc(venues.name), asc(venues.id))
    const [linked] =
      venueId === undefined
        ? []
        : await tx.select().from(barsyVenues).where(eq(barsyVenues.venueId, venueId)).limit(1)
    const [integration] = linked
      ? await tx.select().from(integrations).where(eq(integrations.id, linked.integrationId))
      : await tx
          .select()
          .from(integrations)
          .where(eq(integrations.kind, 'barsy'))
          .orderBy(asc(integrations.createdAt), asc(integrations.id))
          .limit(1)
    if (!integration) return { integration: null, tillRows: [], venues: venueRows }
    const tillRows = await tx
      .select()
      .from(barsyVenues)
      .where(eq(barsyVenues.integrationId, integration.id))
      .orderBy(asc(barsyVenues.name), asc(barsyVenues.bid))
    return { integration, tillRows, venues: venueRows }
  })
}

/**
 * The connection check or full pull of this integration that is queued or running, from
 * pg-boss's job table (the worker owns it). With a `venueId` only that venue's pull counts (a
 * pull of another venue does not keep this venue's button shut). A job table that is not there
 * (the worker has never started against this database) means nothing is waiting.
 */
export async function readActiveJob(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  venueId?: string,
): Promise<ActiveJob> {
  try {
    const ofVenue =
      venueId === undefined
        ? sql``
        : sql`and (name = ${JOB_NAMES.barsyConnect} or data ->> 'venueId' = ${venueId})`
    const result = await withTenant(pool, tenantId, (tx) =>
      tx.execute(
        sql`select name from pgboss.job
            where name in (${JOB_NAMES.barsyConnect}, ${JOB_NAMES.barsyFullPull})
              and state::text in ('created', 'retry', 'active')
              and data ->> 'integrationId' = ${integrationId}
              and data ->> 'tenantId' = ${tenantId}
              ${ofVenue}
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

function toRunView(run: JobRun, venueNames: ReadonlyMap<string, string>): RunView {
  const details = run.details
  const absenceHeld = absenceHeldOf(details)
  const venueId = details?.venue_id
  return {
    id: run.id,
    kind: run.kind,
    status: run.status as RunView['status'],
    venue:
      venueId !== undefined && venueNames.has(venueId)
        ? { id: venueId, name: venueNames.get(venueId) ?? '' }
        : null,
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

/** The latest of the last full and the last incremental pull of a till venue, from the sync state. */
function lastSyncOf(integration: Integration, bid: number): string | null {
  const sync = readSyncState(integration.config, bid)
  const moments = [sync.last_full_pull_at, sync.last_incremental_at].filter(
    (moment): moment is string => moment !== undefined,
  )
  return moments.sort().at(-1) ?? null
}

/**
 * The automatic sync (D59, D73) and when the next syncs are planned. One schedule for the whole
 * installation, in its time zone. Scheduled syncs run for a connected integration and each linked
 * venue with a menu category (the worker's tick lists exactly those); the next times are the
 * earliest of theirs. For any other the card names no times.
 */
function syncSettingsViewOf(
  integration: Integration | null,
  scheduled: readonly BarsyVenue[],
  now: Date,
): SyncSettingsView {
  const settings = parseSyncSettings(integration?.config)
  const scheduleActive =
    integration !== null && integration.status === 'connected' && scheduled.length > 0
  let nextIncrementalAt: Date | null = null
  let nextFullPullAt: Date | null = null
  if (scheduleActive) {
    try {
      const zone = syncTimeZone(integration.config)
      for (const row of scheduled) {
        const next = nextSyncRuns(
          now,
          zone,
          settings.schedule,
          readSyncState(integration.config, row.bid),
        )
        if (next.incremental && (!nextIncrementalAt || next.incremental < nextIncrementalAt)) {
          nextIncrementalAt = next.incremental
        }
        if (next.fullPull && (!nextFullPullAt || next.fullPull < nextFullPullAt)) {
          nextFullPullAt = next.fullPull
        }
      }
    } catch (error) {
      // A time zone the runtime does not know: the card shows the settings and no times.
      logError('integration_next_runs_failed', error)
      nextIncrementalAt = null
      nextFullPullAt = null
    }
  }
  return {
    incrementalEnabled: settings.schedule.incremental_enabled,
    incrementalMinutes: settings.schedule.incremental_minutes,
    fullPullEnabled: settings.schedule.full_pull_enabled,
    fullPullTime: settings.schedule.full_pull_time,
    scheduleActive,
    nextIncrementalAt: nextIncrementalAt?.toISOString() ?? null,
    nextFullPullAt: nextFullPullAt?.toISOString() ?? null,
  }
}

/** The held syncs with the venue each concerns; an old run that names none counts for the only linked venue. */
function heldSyncsWithVenues(
  entries: readonly HeldSyncEntry[],
  names: ReadonlyMap<string, string>,
  linkedVenueIds: readonly string[],
): HeldSyncOfVenue[] {
  return entries.map(({ venueId, held }) => {
    const id = venueId ?? (linkedVenueIds.length === 1 ? (linkedVenueIds[0] ?? null) : null)
    const name = id === null ? undefined : names.get(id)
    return { ...held, venue: id !== null && name !== undefined ? { id, name } : null }
  })
}

/** Everything Settings -> Integrations shows, in one read. */
export async function loadIntegrationView(
  scope: IntegrationScope,
  services: Pick<IntegrationServices, 'sealPublicKey'>,
  now: Date = new Date(),
): Promise<IntegrationView> {
  const { integration, tillRows, venues: allVenues } = await loadState(scope)
  const venueNames = new Map(allVenues.map((venue) => [venue.id, venue.name]))
  const sealReady = isSealKeyUsable(services.sealPublicKey)

  if (!integration) {
    return {
      canManage: scope.canManage,
      sealReady,
      timeZone: syncTimeZone(null),
      integration: null,
      activeJob: null,
      tillVenues: [],
      linkableVenues: allVenues,
      heldSyncs: [],
      mapping: {
        allergenKey: null,
        allergenDetected: null,
        allergenOptions: [],
        defaultLocale: DEFAULT_LOCALE,
      },
      syncSettings: syncSettingsViewOf(null, [], now),
      gate: syncAllGate({
        canManage: scope.canManage,
        integration: null,
        linkedVenues: 0,
        linkedWithCategory: 0,
        activeJob: null,
      }),
      runs: [],
    }
  }

  const activeJob = await readActiveJob(scope.pool, scope.tenantId, integration.id)
  const read = await withTenant(scope.pool, scope.tenantId, async (tx) => {
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
    // Hints for the list and the held-sync warnings, read from what the sync stored. They never
    // choose anything: a venue without a record simply has no hint.
    return {
      runs,
      detailsPayload: details?.payload ?? null,
      hints: await readVenueHints(tx, integration.id),
      held: await readHeldSyncs(tx, integration.id),
    }
  })

  const notUsed = readNotUsedVenues(integration.config)
  const linked = tillRows.filter((row) => row.venueId !== null)
  const linkedVenueIds = linked.flatMap((row) => (row.venueId === null ? [] : [row.venueId]))
  const withCategory = linked.filter((row) => row.catalogueRootCatId !== null)

  const tillVenues: TillVenueRow[] = tillRows.map((row) => {
    const hint: VenueHint | undefined = read.hints.get(row.bid)
    const venue =
      row.venueId === null ? null : { id: row.venueId, name: venueNames.get(row.venueId) ?? '' }
    return {
      key: row.bid,
      name: row.name,
      state: venue !== null ? 'linked' : notUsed.has(row.bid) ? 'not_used' : 'unlinked',
      venue,
      hasMenuCategory: row.catalogueRootCatId !== null,
      ...(hint?.address ? { address: hint.address } : {}),
      ...(hint?.publicCatId != null ? { publicMenuSetUp: true as const } : {}),
    }
  })
  const linkedIds = new Set(linkedVenueIds)

  const config = integration.config
  const info: IntegrationInfo = {
    host: integration.host,
    hasCredentials: integration.credentialsSealed !== null,
    status: integration.status as IntegrationStatus,
    statusDetail: integration.statusDetail,
    lastCheckedAt: integration.lastCheckedAt?.toISOString() ?? null,
  }

  return {
    canManage: scope.canManage,
    sealReady,
    timeZone: syncTimeZone(config),
    integration: info,
    activeJob,
    tillVenues,
    linkableVenues: allVenues.filter((venue) => !linkedIds.has(venue.id)),
    heldSyncs: heldSyncsWithVenues(read.held, venueNames, linkedVenueIds),
    mapping: {
      allergenKey:
        typeof config.allergen_detail_key === 'string' ? config.allergen_detail_key : null,
      allergenDetected: detectAllergenOption(readDetailOptions(read.detailsPayload)),
      allergenOptions: readDetailOptions(read.detailsPayload),
      defaultLocale: isLocale(config.default_locale) ? config.default_locale : DEFAULT_LOCALE,
    },
    syncSettings: syncSettingsViewOf(integration, withCategory, now),
    gate: syncAllGate({
      canManage: scope.canManage,
      integration: { hasCredentials: info.hasCredentials, status: info.status },
      linkedVenues: linked.length,
      linkedWithCategory: withCategory.length,
      activeJob,
    }),
    runs: read.runs.map((run) => toRunView(run, venueNames)),
  }
}

/** The pickers' entries for the venues of the installation that a venue could serve. */
function tillVenueOptions(
  rows: readonly BarsyVenue[],
  names: ReadonlyMap<string, string>,
  notUsed: ReadonlySet<number>,
  hints: ReadonlyMap<number, VenueHint>,
  exceptVenueId: string,
): TillVenueOption[] {
  return rows
    .filter((row) => row.venueId !== exceptVenueId)
    .map((row) => {
      const hint = hints.get(row.bid)
      return {
        key: row.bid,
        name: row.name,
        usedBy: row.venueId === null ? null : (names.get(row.venueId) ?? ''),
        notUsed: row.venueId === null && notUsed.has(row.bid),
        ...(hint?.address ? { address: hint.address } : {}),
        ...(hint?.publicCatId != null ? { publicMenuSetUp: true as const } : {}),
      }
    })
}

/** Everything a venue's Menu source card shows, in one read. */
export async function loadMenuSourceView(scope: VenueScope): Promise<MenuSourceView> {
  const { integration, tillRows, venues: allVenues } = await loadState(scope, scope.venue.id)
  if (!integration) return { state: 'no_integration', canManage: scope.canManage }

  const names = new Map(allVenues.map((venue) => [venue.id, venue.name]))
  const mapped = tillRows.find((row) => row.venueId === scope.venue.id) ?? null
  const { hints, held } = await withTenant(scope.pool, scope.tenantId, async (tx) => ({
    hints: await readVenueHints(tx, integration.id),
    held: await readHeldSyncs(tx, integration.id),
  }))
  const notUsed = readNotUsedVenues(integration.config)
  const options = tillVenueOptions(tillRows, names, notUsed, hints, scope.venue.id)

  if (mapped === null) {
    // Only the ones with no venue are offered to a venue that has none.
    return {
      state: 'unlinked',
      canManage: scope.canManage,
      options: options.filter((option) => option.usedBy === null),
    }
  }

  const activeJob = await readActiveJob(scope.pool, scope.tenantId, integration.id, scope.venue.id)
  const cached = readCachedTree(integration.config, mapped.bid)
  const suggestedCatId = hints.get(mapped.bid)?.publicCatId ?? null
  const linkedVenueIds = tillRows.flatMap((row) => (row.venueId === null ? [] : [row.venueId]))
  const heldHere: HeldSync | null =
    heldSyncsWithVenues(held, names, linkedVenueIds).find(
      (entry) => entry.venue?.id === scope.venue.id,
    ) ?? null
  const info = {
    hasCredentials: integration.credentialsSealed !== null,
    status: integration.status as IntegrationStatus,
  }

  const view: LinkedMenuSource = {
    state: 'linked',
    canManage: scope.canManage,
    timeZone: scope.venue.timezone,
    tillVenueName: mapped.name,
    options,
    tree: cached ? buildCategoryTree(cached.categories, suggestedCatId) : null,
    treeFetchedAt: cached?.fetched_at ?? null,
    rootCatId: mapped.catalogueRootCatId,
    // The price is per venue (D73, CF-16): the venue's own setting, else the integration's.
    priceSource: priceSourceOf(mapped.priceSource ?? integration.config.price_source),
    lastSyncedAt: lastSyncOf(integration, mapped.bid),
    heldSync:
      heldHere === null
        ? null
        : {
            reason: heldHere.reason,
            wouldHide: heldHere.wouldHide,
            active: heldHere.active,
            finishedAt: heldHere.finishedAt,
          },
    activeJob,
    gate: syncGate({
      canManage: scope.canManage,
      integration: info,
      venueMapped: true,
      rootChosen: mapped.catalogueRootCatId !== null,
      activeJob,
    }),
  }
  return view
}

// --- writing: the connection -----------------------------------------------------------------

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
 * state, the "Not used" marks and the venue choices of the old host are forgotten. It is refused
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
    ...(hostChanged ? { config: { catalogue_trees: null, sync: null, not_used: null } } : {}),
  })
  if (!updated) return fail('not_found')
  return { ok: true, queued: await queueConnect(scope, services, integrationId) }
}

/** "Check again": queues the connection check of the organisation's integration. */
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

// --- writing: the venues of the installation -------------------------------------------------

/** The "Not used" mark of a venue that is being linked is taken off: it is used now. */
async function forgetNotUsed(scope: IntegrationScope, integration: Integration, bid: number) {
  if (!readNotUsedVenues(integration.config).has(bid)) return
  await setTillVenueNotUsed(scope.pool, scope.tenantId, integration.id, bid, false)
}

/**
 * "Add as venue": makes a venue of ours named after the till venue (the New venue defaults: its
 * address from the name, Europe/Sofia, euro, Bulgarian and English, an empty menu and a public
 * code of its own) and links the two, in one transaction. Only a till venue that serves no venue
 * yet. The answer carries the new venue, which the person is sent to: its Menu source card is
 * where the menu category is chosen.
 */
export async function addTillVenueAsVenue(
  scope: IntegrationScope,
  input: { readonly bid: number },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration, tillRows } = await loadState(scope)
  if (integration === null) return fail('not_found')
  const row = tillRows.find((candidate) => candidate.bid === input.bid)
  if (!row) return fail('not_found')
  if (row.venueId !== null) return fail('till_venue_taken')
  try {
    const added = await addVenueFromTillVenue(scope.pool, scope.tenantId, integration.id, row.bid, {
      name: row.name.trim().slice(0, MAX_VENUE_NAME_LENGTH),
      slug: suggestSlug(row.name) || 'venue',
    })
    if (!added.ok) return fail(added.error === 'link_taken' ? 'till_venue_taken' : 'not_found')
    await forgetNotUsed(scope, integration, row.bid)
    return { ok: true, venueId: added.venue.id }
  } catch (error) {
    if (error instanceof ProvisionError && error.code === 'invalid_input') return fail('invalid')
    throw error
  }
}

/**
 * "Link to an existing venue": gives a venue of ours that serves no till venue yet to a till
 * venue that serves none. A venue that already has a link is refused (`venue_already_linked`):
 * moving a venue is the deliberate "Change…" of its own Menu source card.
 */
export async function linkTillVenue(
  scope: IntegrationScope,
  input: { readonly bid: number; readonly venueId: string },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration } = await loadState(scope)
  if (integration === null) return fail('not_found')
  const result = await mapBarsyVenue(
    scope.pool,
    scope.tenantId,
    integration.id,
    input.bid,
    input.venueId,
    { venueMustBeUnlinked: true },
  )
  if (!result.ok) {
    if (result.error === 'barsy_venue_taken') return fail('till_venue_taken')
    return fail(result.error === 'venue_already_linked' ? 'venue_already_linked' : 'not_found')
  }
  await forgetNotUsed(scope, integration, input.bid)
  return { ok: true }
}

/**
 * Sets a till venue aside as "Not used" (a shop, a catering unit, "Services") so it stops counting
 * as something to do, or takes the mark off again. Only a till venue that serves no venue can be
 * set aside. Kept in the integration's config (`not_used`), so it needs no migration.
 */
export async function markTillVenue(
  scope: IntegrationScope,
  input: { readonly bid: number; readonly notUsed: boolean },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration, tillRows } = await loadState(scope)
  if (integration === null) return fail('not_found')
  const row = tillRows.find((candidate) => candidate.bid === input.bid)
  if (!row) return fail('not_found')
  if (input.notUsed && row.venueId !== null) return fail('till_venue_linked')
  const stored = await setTillVenueNotUsed(
    scope.pool,
    scope.tenantId,
    integration.id,
    row.bid,
    input.notUsed,
  )
  return stored ? { ok: true } : fail('not_found')
}

// --- writing: how the data is read, the schedule, the syncs ----------------------------------

/** How the till's data is read for the whole installation: allergen characteristic (null = detect) and language. */
export interface MappingSettingsInput {
  readonly allergenKey: string | null
  readonly defaultLocale: string
}

/**
 * Saves how the data is read; it applies from the next pull. The price is not here: it is the
 * setting of each venue (D73, CF-16: prices differ per venue; `saveVenuePrice`).
 */
export async function saveMappingSettings(
  scope: IntegrationScope,
  input: MappingSettingsInput,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  if (!isLocale(input.defaultLocale)) return fail('invalid')
  const { integration } = await loadState(scope)
  if (integration === null) return fail('not_found')
  if (input.allergenKey !== null) {
    const payload = await withTenant(scope.pool, scope.tenantId, async (tx) => {
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
      return details?.payload ?? null
    })
    if (!readDetailOptions(payload).some((option) => option.key === input.allergenKey)) {
      return fail('invalid')
    }
  }
  const updated = await updateIntegration(scope.pool, scope.tenantId, integration.id, {
    config: {
      // null removes the key: the sync detects the characteristic by its name again.
      allergen_detail_key: input.allergenKey,
      default_locale: input.defaultLocale,
    },
  })
  return updated ? { ok: true } : fail('not_found')
}

/**
 * Saves the automatic sync (D59): when the till is read, in the integration's time zone. Stored in
 * the integration's config (`schedule`), and the worker's next tick follows it. The publishing
 * rules are the venue's now (`setVenuePublishRules`).
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
  const { integration } = await loadState(scope)
  if (integration === null) return fail('not_found')
  const updated = await saveSyncSettingsConfig(
    scope.pool,
    scope.tenantId,
    integration.id,
    parsed.data,
  )
  return updated ? { ok: true } : fail('not_found')
}

/** "Sync everything now": queues a full pull of every linked venue that has a menu category, if the gate is open. */
export async function syncAll(
  scope: IntegrationScope,
  services: IntegrationServices,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration, tillRows } = await loadState(scope)
  if (integration === null) return fail('not_ready')
  const activeJob = await readActiveJob(scope.pool, scope.tenantId, integration.id)
  const linked = tillRows.flatMap((row) =>
    row.venueId === null ? [] : [{ ...row, venueId: row.venueId }],
  )
  const pullable = linked.filter((row) => row.catalogueRootCatId !== null)
  const gate = syncAllGate({
    canManage: scope.canManage,
    integration: {
      hasCredentials: integration.credentialsSealed !== null,
      status: integration.status as IntegrationStatus,
    },
    linkedVenues: linked.length,
    linkedWithCategory: pullable.length,
    activeJob,
  })
  if (!gate.enabled) return fail(gate.reason === 'busy' ? 'already_running' : 'not_ready')
  let queued = 0
  try {
    // The worker runs them one after the other (one pull at a time per installation, CF-16).
    for (const row of pullable) {
      const id = await services.enqueue(JOB_NAMES.barsyFullPull, {
        tenantId: scope.tenantId as TenantId,
        integrationId: integration.id as IntegrationId,
        venueId: row.venueId as VenueId,
      })
      if (id !== null) queued += 1
    }
  } catch (error) {
    logError('integration_sync_not_queued', error)
    return fail('queue_unavailable')
  }
  return queued === 0 ? fail('already_running') : { ok: true, pulls: queued }
}

// --- writing: a venue's Menu source ----------------------------------------------------------

/**
 * Gives this venue a till venue, or moves it to another one ("Link a barsy venue", "Change…").
 * A venue serves one till venue and a till venue serves one venue: one that serves another venue
 * is refused (`till_venue_taken`); a venue that served a different one is moved (that one is
 * freed). The categories already read stay in the menu; the next full sync decides which items
 * still exist (T62 warns before this is done).
 */
export async function chooseTillVenue(
  scope: VenueScope,
  input: { readonly bid: number },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration } = await loadState(scope, scope.venue.id)
  if (integration === null) return fail('not_found')
  const result = await mapBarsyVenue(
    scope.pool,
    scope.tenantId,
    integration.id,
    input.bid,
    scope.venue.id,
  )
  if (!result.ok) {
    return fail(result.error === 'barsy_venue_taken' ? 'till_venue_taken' : 'not_found')
  }
  await forgetNotUsed(scope, integration, input.bid)
  return { ok: true }
}

/** Chooses the category of the till venue's public tree that this venue's menu is read from. */
export async function chooseCatalogueRoot(
  scope: VenueScope,
  input: { readonly catId: number },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration, tillRows } = await loadState(scope, scope.venue.id)
  const mapped = tillRows.find((row) => row.venueId === scope.venue.id)
  if (integration === null || mapped === undefined) return fail('not_ready')
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

/**
 * Saves which till price this venue's menu shows (D73: per venue, because the till prices by
 * venue). Written on the venue's own link; it applies from the next pull of this venue.
 */
export async function saveVenuePrice(
  scope: VenueScope,
  input: { readonly priceSource: PriceSource },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  if (input.priceSource !== 'actual_price' && input.priceSource !== 'current_price') {
    return fail('invalid')
  }
  const { integration, tillRows } = await loadState(scope, scope.venue.id)
  const mapped = tillRows.find((row) => row.venueId === scope.venue.id)
  if (integration === null || mapped === undefined) return fail('not_ready')
  const stored = await setVenuePriceSource(
    scope.pool,
    scope.tenantId,
    integration.id,
    mapped.bid,
    input.priceSource,
  )
  return stored ? { ok: true } : fail('not_found')
}

/** "Sync this venue": queues a full pull of this venue, if the gate is open. */
export async function syncNow(
  scope: VenueScope,
  services: IntegrationServices,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const { integration, tillRows } = await loadState(scope, scope.venue.id)
  if (integration === null) return fail('not_ready')
  const mapped = tillRows.find((row) => row.venueId === scope.venue.id) ?? null
  const activeJob = await readActiveJob(scope.pool, scope.tenantId, integration.id, scope.venue.id)
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
