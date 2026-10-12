// Settings -> Integrations and the venue's Menu source card: their reads and writes (adjustments
// I1 and I2, D81, D82). Server actions (actions.ts) are thin wrappers: they check who is asking and
// what was sent, then call these functions, which take everything they need as arguments (the
// database pool, the tenant, the sealing key, the queue) so tests run them against a real Postgres
// without a signed-in person.
//
// What this file never does:
//   - call a POS or open credentials (the web only seals; the worker opens);
//   - return, log or store a password: it exists in memory until it is sealed, and only the
//     sealed envelope goes to the database;
//   - write the menu document (that stays `apply()`'s); it writes the instance, the organisation's
//     systems and a connector's settings through core's writers, and queues jobs;
//   - name a system. What belongs to one POS (its address rules, its sealing, its jobs, its own
//     settings) comes from its connector in `connectors/`, looked up by the instance's kind.
//
// Three scopes: `IntegrationScope` is the organisation (the Settings page), `VenueScope` adds the
// venue whose Menu source card it is.
import { connectorLabel, isId, newId, syncTimeZone } from '@restro/core'
import {
  createIntegration,
  MAX_INTEGRATION_NAME_LENGTH,
  ProvisionError,
  readOrganizationSystems,
  removeIntegration,
  setOrganizationSystems,
  updateIntegration,
} from '@restro/core/apply'
import { parseSealPublicKey, SealError } from '@restro/core/seal'
import {
  type DbPool,
  type Integration,
  integrations,
  type JobRun,
  jobRuns,
  sourceLinks,
  venues,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'

import { connectorServer, SYSTEM_KINDS } from '../../connectors/server'
import type { ConnectorServer, Enqueue } from '../../connectors/server-types'
import { absenceHeldOf, type HeldSyncEntry } from '../../connectors/sync-reads'
import { type TillVenueLink, tillVenueLinks } from '../../connectors/till-venues'
import { logError } from '../log'
import { syncAllGate, syncGate } from './gating'
import type {
  ActiveJob,
  HeldSync,
  HeldSyncOfVenue,
  InstanceView,
  IntegrationActionResult,
  IntegrationErrorCode,
  IntegrationStatus,
  IntegrationsView,
  LinkedMenuSource,
  MenuSourceView,
  RunView,
  SystemOption,
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
  readonly enqueue: Enqueue
}

/** How many runs a history shows. */
export const HISTORY_LENGTH = 20
/**
 * Photo downloads write one run per picture; listed among the sync runs they would push every
 * pull out of the latest twenty, so the history leaves them out.
 */
export const HISTORY_EXCLUDED_KINDS = ['asset_fetch'] as const

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

/** An instance's name as stored: trimmed, 1 to 80 characters; null when it is neither. */
function checkedName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name === '' || name.length > MAX_INTEGRATION_NAME_LENGTH ? null : name
}

// --- reading ---------------------------------------------------------------------------------

/** The instance of this organisation with this id, if it is not removed. */
async function loadInstance(
  scope: IntegrationScope,
  integrationId: string,
): Promise<Integration | null> {
  if (!isId('in', integrationId)) return null
  const [row] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select()
      .from(integrations)
      .where(and(eq(integrations.id, integrationId), isNull(integrations.removedAt))),
  )
  return row ?? null
}

/** The live venues of the organisation (a deleted one is not offered or pulled, D76). */
async function liveVenues(scope: IntegrationScope): Promise<VenueRef[]> {
  return withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(isNull(venues.archivedAt))
      .orderBy(asc(venues.name), asc(venues.id)),
  )
}

/** The links of an instance's venues to venues of ours (the ones that serve a venue). */
async function loadLinks(scope: IntegrationScope, integrationId: string): Promise<TillVenueLink[]> {
  return withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select()
      .from(tillVenueLinks)
      .where(
        and(eq(tillVenueLinks.integrationId, integrationId), isNotNull(tillVenueLinks.venueId)),
      )
      .orderBy(asc(tillVenueLinks.name), asc(tillVenueLinks.bid)),
  )
}

/**
 * The connection check or full pull of this instance that is queued or running, from pg-boss's job
 * table (the worker owns it). With a `venueId` only that venue's pull counts (a pull of another
 * venue does not keep this venue's button shut). A job table that is not there (the worker has
 * never started against this database) means nothing is waiting.
 */
export async function readActiveJob(
  pool: DbPool,
  tenantId: string,
  instance: Pick<Integration, 'id' | 'kind'>,
  venueId?: string,
): Promise<ActiveJob> {
  const connector = connectorServer(instance.kind)
  if (connector === null) return null
  const { connect, pull } = connector.jobNames
  try {
    const ofVenue =
      venueId === undefined
        ? sql``
        : sql`and (name = ${connect} or data ->> 'venueId' = ${venueId})`
    const result = await withTenant(pool, tenantId, (tx) =>
      tx.execute(
        sql`select name from pgboss.job
            where name in (${connect}, ${pull})
              and state::text in ('created', 'retry', 'active')
              and data ->> 'integrationId' = ${instance.id}
              and data ->> 'tenantId' = ${tenantId}
              ${ofVenue}
            limit 10`,
      ),
    )
    const names = result.rows.map((row) => String(row.name))
    if (names.includes(pull)) return 'pull'
    if (names.includes(connect)) return 'connect'
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

const idOf = (link: TillVenueLink): string => link.venueId ?? ''

/** One instance as the screen shows it: everything read for it, in one go. */
async function instanceView(
  scope: IntegrationScope,
  connector: ConnectorServer,
  row: Integration,
  live: ReadonlyMap<string, string>,
): Promise<InstanceView> {
  const links = (await loadLinks(scope, row.id)).filter((link) => live.has(idOf(link)))
  const activeJob = await readActiveJob(scope.pool, scope.tenantId, row)
  const read = await withTenant(scope.pool, scope.tenantId, async (tx) => ({
    runs: await tx
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.integrationId, row.id), ne(jobRuns.kind, HISTORY_EXCLUDED_KINDS[0])))
      .orderBy(desc(jobRuns.createdAt), desc(jobRuns.id))
      .limit(HISTORY_LENGTH),
    settings: await connector.loadInstanceSettings(tx, row),
    held: await connector.readHeldSyncs(tx, row.id),
  }))
  const hasCredentials = row.credentialsSealed !== null
  const status = row.status as IntegrationStatus
  return {
    id: row.id,
    kind: row.kind,
    source: connectorLabel(connector.kind),
    name: row.name,
    host: row.host,
    hasCredentials,
    status,
    statusDetail: row.statusDetail,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    timeZone: syncTimeZone(row.config),
    activeJob,
    venues: links.map((link) => ({ id: idOf(link), name: live.get(idOf(link)) ?? '' })),
    heldSyncs: heldSyncsWithVenues(read.held, live, links.map(idOf)),
    gate: syncAllGate({
      canManage: scope.canManage,
      integration: { hasCredentials, status },
      linkedVenues: links.length,
      pullableVenues: links.filter((link) => connector.canPull(link)).length,
      activeJob,
    }),
    runs: read.runs.map((run) => toRunView(run, live)),
    settings: read.settings,
  }
}

/** Everything Settings -> Integrations shows, in one read. */
export async function loadIntegrationsView(
  scope: IntegrationScope,
  services: Pick<IntegrationServices, 'sealPublicKey'>,
): Promise<IntegrationsView> {
  const chosen = await readOrganizationSystems(scope.pool, scope.tenantId)
  const rows = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select()
      .from(integrations)
      .where(isNull(integrations.removedAt))
      .orderBy(asc(integrations.createdAt), asc(integrations.id)),
  )
  const live = new Map((await liveVenues(scope)).map((venue) => [venue.id, venue.name]))
  const instances: InstanceView[] = []
  for (const row of rows) {
    const connector = connectorServer(row.kind)
    // A kind this build does not know has no tab to show it in.
    if (connector !== null) instances.push(await instanceView(scope, connector, row, live))
  }
  const systems: SystemOption[] = SYSTEM_KINDS.map((kind) => ({
    kind,
    label: connectorLabel(kind),
    instances: instances.filter((instance) => instance.kind === kind).length,
  }))
  return {
    canManage: scope.canManage,
    sealReady: isSealKeyUsable(services.sealPublicKey),
    systems,
    chosen,
    instances,
  }
}

/** Everything a venue's Menu source card shows, in one read: nothing for a venue made by hand. */
export async function loadMenuSourceView(scope: VenueScope): Promise<MenuSourceView> {
  const [link] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx.select().from(tillVenueLinks).where(eq(tillVenueLinks.venueId, scope.venue.id)).limit(1),
  )
  if (link === undefined) return { state: 'none' }
  const integration = await loadInstance(scope, link.integrationId)
  const connector = integration === null ? null : connectorServer(integration.kind)
  if (integration === null || connector === null) return { state: 'none' }

  const live = new Map((await liveVenues(scope)).map((venue) => [venue.id, venue.name]))
  const linkedVenueIds = (await loadLinks(scope, integration.id))
    .map(idOf)
    .filter((id) => live.has(id))
  const activeJob = await readActiveJob(scope.pool, scope.tenantId, integration, scope.venue.id)
  const read = await withTenant(scope.pool, scope.tenantId, async (tx) => ({
    runs: await tx
      .select()
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.integrationId, integration.id),
          ne(jobRuns.kind, HISTORY_EXCLUDED_KINDS[0]),
          sql`${jobRuns.details} ->> 'venue_id' = ${scope.venue.id}`,
        ),
      )
      .orderBy(desc(jobRuns.createdAt), desc(jobRuns.id))
      .limit(HISTORY_LENGTH),
    held: await connector.readHeldSyncs(tx, integration.id),
  }))
  const heldHere = heldSyncsWithVenues(read.held, live, linkedVenueIds).find(
    (entry) => entry.venue?.id === scope.venue.id,
  )
  const heldSync: HeldSync | null =
    heldHere === undefined
      ? null
      : {
          reason: heldHere.reason,
          wouldHide: heldHere.wouldHide,
          active: heldHere.active,
          finishedAt: heldHere.finishedAt,
        }
  const info = {
    hasCredentials: integration.credentialsSealed !== null,
    status: integration.status as IntegrationStatus,
  }
  const view: LinkedMenuSource = {
    state: 'linked',
    canManage: scope.canManage,
    timeZone: scope.venue.timezone,
    source: connectorLabel(connector.kind),
    instanceName: integration.name,
    tillVenueName: link.name,
    lastSyncedAt: connector.lastSyncedAt(integration, link),
    heldSync,
    activeJob,
    gate: syncGate({
      canManage: scope.canManage,
      integration: info,
      venueLinked: true,
      menuKnown: connector.canPull(link),
      activeJob,
    }),
    runs: read.runs.map((run) => toRunView(run, new Map([[scope.venue.id, scope.venue.name]]))),
    connector: connector.loadVenueSource(integration, link),
  }
  return view
}

// --- writing: the systems ---------------------------------------------------------------------

/**
 * Saves the systems the organisation uses. Leaving out a system that still has instances is
 * refused (`has_instances`): remove its instances first (D81).
 */
export async function saveSystems(
  scope: IntegrationScope,
  systems: readonly string[],
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const saved = await setOrganizationSystems(scope.pool, scope.tenantId, systems)
  if (saved.ok) return { ok: true }
  return fail(saved.error === 'has_instances' ? 'has_instances' : 'invalid')
}

// --- writing: the connection ------------------------------------------------------------------

/** What the connect form sends. `password` is read once, to seal it; it is never kept or returned. */
export interface ConnectionInput {
  readonly host: string
  readonly user: string
  readonly password: string
}

async function queueConnect(
  scope: IntegrationScope,
  services: IntegrationServices,
  connector: ConnectorServer,
  integrationId: string,
): Promise<boolean> {
  try {
    await connector.queueConnect(services.enqueue, { tenantId: scope.tenantId, integrationId })
    return true
  } catch (error) {
    logError('integration_connect_not_queued', error)
    return false
  }
}

type Sealed = { readonly sealed: string } | { readonly error: IntegrationErrorCode }

/** Seals for one instance id: the envelope is bound to it and to the host, so the id comes first. */
function sealFor(
  scope: IntegrationScope,
  services: IntegrationServices,
  connector: ConnectorServer,
  integrationId: string,
  host: string,
  credentials: { user: string; password: string },
): Sealed {
  const publicKey = services.sealPublicKey
  if (!isSealKeyUsable(publicKey)) return { error: 'sync_keys_missing' }
  try {
    const sealed = connector.seal(credentials, {
      publicKey,
      tenantId: scope.tenantId,
      integrationId,
      host,
    })
    return { sealed }
  } catch (error) {
    if (error instanceof SealError) {
      return { error: error.code === 'invalid_key' ? 'sync_keys_missing' : 'invalid' }
    }
    throw error
  }
}

/** Another instance of the same system that is not removed already uses this host. */
async function hostInUse(
  scope: IntegrationScope,
  kind: string,
  host: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.kind, kind),
          eq(integrations.host, host),
          isNull(integrations.removedAt),
        ),
      ),
  )
  return rows.some((row) => row.id !== exceptId)
}

/**
 * Whether the instance already serves venues or holds a menu: a venue linked to it, or a link from
 * one of its objects to an item, section or option of ours in any state. Ids of a system are
 * unique only per installation, so another installation's article 11 would land on our old item 11
 * and keep its photo and copy (B1-F14); and a venue's source never changes (D87).
 */
async function instanceIsInUse(scope: IntegrationScope, integrationId: string): Promise<boolean> {
  return withTenant(scope.pool, scope.tenantId, async (tx) => {
    const [link] = await tx
      .select({ integrationId: sourceLinks.integrationId })
      .from(sourceLinks)
      .where(eq(sourceLinks.integrationId, integrationId))
      .limit(1)
    if (link !== undefined) return true
    const [venue] = await tx
      .select({ venueId: tillVenueLinks.venueId })
      .from(tillVenueLinks)
      .where(
        and(eq(tillVenueLinks.integrationId, integrationId), isNotNull(tillVenueLinks.venueId)),
      )
      .limit(1)
    return venue !== undefined
  })
}

/** What "Add {source}" sends. */
export interface NewInstanceInput extends ConnectionInput {
  readonly kind: string
  /** What the owner calls the connection; empty: "<system> – <host>". */
  readonly name?: string
}

/**
 * "Add {source}": a new named instance of a chosen system, with its credentials sealed for the
 * worker (bound to this tenant, the new id and the host), and the connection check queued. The
 * system must be one the organisation chose (`system_not_chosen`); the host must not belong to
 * another instance of that system (`host_in_use`).
 */
export async function addInstance(
  scope: IntegrationScope,
  services: IntegrationServices,
  input: NewInstanceInput,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const connector = connectorServer(input.kind)
  if (connector === null) return fail('invalid')
  if (!(await readOrganizationSystems(scope.pool, scope.tenantId)).includes(connector.kind)) {
    return fail('system_not_chosen')
  }
  const parsed = connector.parseHost(input.host)
  if (!parsed.ok) return fail('invalid_host')
  const { host } = parsed
  const typed = input.name?.trim() ?? ''
  const name = typed === '' ? `${connectorLabel(connector.kind)} – ${host}` : checkedName(typed)
  if (name === null) return fail('invalid')
  if (!isSealKeyUsable(services.sealPublicKey)) return fail('sync_keys_missing')
  if (await hostInUse(scope, connector.kind, host)) return fail('host_in_use')

  const id = newId('in')
  const sealed = sealFor(scope, services, connector, id, host, {
    user: input.user,
    password: input.password,
  })
  if ('error' in sealed) return fail(sealed.error)
  try {
    const created = await createIntegration(scope.pool, scope.tenantId, {
      kind: connector.kind,
      host,
      id,
      name,
      credentialsSealed: sealed.sealed,
    })
    // The host exists already (another request got there first).
    if (!created.created) return fail('host_in_use')
  } catch (error) {
    if (error instanceof ProvisionError && error.code === 'invalid_input') return fail('invalid')
    throw error
  }
  return { ok: true, integrationId: id, queued: await queueConnect(scope, services, connector, id) }
}

/**
 * Saves the connection of an instance: seals `{user, password}` for the worker (bound to this
 * tenant, the instance and the host), writes the instance and queues the connection check.
 *
 * Changing the host asks for the credentials again by construction (every save carries them) and
 * is a different installation: its status goes back to `new`, and what was cached and chosen for
 * the old host is forgotten. It is refused (`host_change_blocked`) while the instance serves a
 * venue or holds a menu, since the ids of another installation would land on the old items; add
 * another instance for the other installation instead.
 */
export async function saveConnection(
  scope: IntegrationScope,
  services: IntegrationServices,
  input: ConnectionInput & { readonly integrationId: string },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const instance = await loadInstance(scope, input.integrationId)
  const connector = instance === null ? null : connectorServer(instance.kind)
  if (instance === null || connector === null) return fail('not_found')
  const parsed = connector.parseHost(input.host)
  if (!parsed.ok) return fail('invalid_host')
  const { host } = parsed
  if (!isSealKeyUsable(services.sealPublicKey)) return fail('sync_keys_missing')

  const hostChanged = instance.host !== host
  if (hostChanged) {
    // Refused before anything is written. The same host with new credentials is not a change.
    if (await instanceIsInUse(scope, instance.id)) return fail('host_change_blocked')
    if (await hostInUse(scope, instance.kind, host, instance.id)) return fail('host_in_use')
  }
  const sealed = sealFor(scope, services, connector, instance.id, host, {
    user: input.user,
    password: input.password,
  })
  if ('error' in sealed) return fail(sealed.error)
  // A new host is a new installation: what was chosen and cached for the old one means nothing.
  // Forgotten first, so a failure half way never leaves old choices pointing at the new host.
  if (hostChanged) await connector.forgetInstallation(scope.pool, scope.tenantId, instance.id)
  const updated = await updateIntegration(scope.pool, scope.tenantId, instance.id, {
    host,
    credentialsSealed: sealed.sealed,
    status: 'new',
    statusDetail: null,
    ...(hostChanged
      ? {
          config: Object.fromEntries(connector.installationConfigKeys.map((key) => [key, null])),
        }
      : {}),
  })
  if (!updated) return fail('not_found')
  return { ok: true, queued: await queueConnect(scope, services, connector, instance.id) }
}

/** "Check again": queues the connection check of an instance. */
export async function checkConnection(
  scope: IntegrationScope,
  services: IntegrationServices,
  integrationId: string,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const instance = await loadInstance(scope, integrationId)
  const connector = instance === null ? null : connectorServer(instance.kind)
  if (instance === null || connector === null) return fail('not_found')
  if (instance.credentialsSealed === null) return fail('not_ready')
  const queued = await queueConnect(scope, services, connector, instance.id)
  return queued ? { ok: true, queued } : fail('queue_unavailable')
}

/** Renames an instance: what the owner calls the connection (1 to 80 characters). */
export async function renameInstance(
  scope: IntegrationScope,
  input: { readonly integrationId: string; readonly name: string },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const name = checkedName(input.name)
  if (name === null) return fail('invalid')
  const instance = await loadInstance(scope, input.integrationId)
  if (instance === null) return fail('not_found')
  const updated = await updateIntegration(scope.pool, scope.tenantId, instance.id, { name })
  return updated ? { ok: true } : fail('not_found')
}

/**
 * Removes an instance from the screen (D81): refused while a venue links to it (`has_venues`:
 * move or delete those venues first). The connection and its credentials are never erased.
 */
export async function removeInstance(
  scope: IntegrationScope,
  input: { readonly integrationId: string },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  if (!isId('in', input.integrationId)) return fail('not_found')
  const removed = await removeIntegration(scope.pool, scope.tenantId, input.integrationId)
  if (removed.ok) return { ok: true }
  return fail(removed.error === 'has_venues' ? 'has_venues' : 'not_found')
}

// --- writing: a system's own settings ---------------------------------------------------------

/** Saves the system settings of an instance; the connector validates what the card sent. */
export async function saveInstanceSettings(
  scope: IntegrationScope,
  input: { readonly integrationId: string; readonly settings: unknown },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const instance = await loadInstance(scope, input.integrationId)
  const connector = instance === null ? null : connectorServer(instance.kind)
  if (instance === null || connector === null) return fail('not_found')
  const saved = await connector.saveInstanceSettings(
    { pool: scope.pool, tenantId: scope.tenantId, integration: instance },
    input.settings,
  )
  return saved === 'saved' ? { ok: true } : fail(saved === 'invalid' ? 'invalid' : 'not_found')
}

/** The instance and the link a venue's card is about, if the venue serves a venue of a system. */
async function loadVenueSource(scope: VenueScope) {
  const [link] = await withTenant(scope.pool, scope.tenantId, (tx) =>
    tx.select().from(tillVenueLinks).where(eq(tillVenueLinks.venueId, scope.venue.id)).limit(1),
  )
  if (link === undefined) return null
  const integration = await loadInstance(scope, link.integrationId)
  const connector = integration === null ? null : connectorServer(integration.kind)
  return integration === null || connector === null ? null : { link, integration, connector }
}

/** Saves the connector's part of this venue's Menu source (barsy: the price it shows). */
export async function saveVenueSource(
  scope: VenueScope,
  input: { readonly settings: unknown },
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const source = await loadVenueSource(scope)
  if (source === null) return fail('not_ready')
  const saved = await source.connector.saveVenueSource(
    {
      pool: scope.pool,
      tenantId: scope.tenantId,
      integration: source.integration,
      link: source.link,
    },
    input.settings,
  )
  return saved === 'saved' ? { ok: true } : fail(saved === 'invalid' ? 'invalid' : 'not_found')
}

// --- writing: the syncs -----------------------------------------------------------------------

/**
 * "Sync everything now": queues a full pull of every live venue that uses the instance and that
 * its system can read, if the gate is open.
 */
export async function syncAll(
  scope: IntegrationScope,
  services: IntegrationServices,
  integrationId: string,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const instance = await loadInstance(scope, integrationId)
  const connector = instance === null ? null : connectorServer(instance.kind)
  if (instance === null || connector === null) return fail('not_found')
  const activeJob = await readActiveJob(scope.pool, scope.tenantId, instance)
  // Only live venues (D76): a deleted venue's link is released with it, and this keeps one that a
  // race left behind from ever being pulled.
  const live = new Set((await liveVenues(scope)).map((venue) => venue.id))
  const linked = (await loadLinks(scope, instance.id)).filter((link) => live.has(idOf(link)))
  const pullable = linked.filter((link) => connector.canPull(link))
  const gate = syncAllGate({
    canManage: scope.canManage,
    integration: {
      hasCredentials: instance.credentialsSealed !== null,
      status: instance.status as IntegrationStatus,
    },
    linkedVenues: linked.length,
    pullableVenues: pullable.length,
    activeJob,
  })
  if (!gate.enabled) return fail(gate.reason === 'busy' ? 'already_running' : 'not_ready')
  let queued = 0
  try {
    // The worker runs them one after the other (one pull at a time per installation, CF-16).
    for (const link of pullable) {
      const id = await connector.queuePull(services.enqueue, {
        tenantId: scope.tenantId,
        integrationId: instance.id,
        venueId: idOf(link),
      })
      if (id !== null) queued += 1
    }
  } catch (error) {
    logError('integration_sync_not_queued', error)
    return fail('queue_unavailable')
  }
  return queued === 0 ? fail('already_running') : { ok: true, pulls: queued }
}

/** "Sync this venue": queues a full pull of this venue, if the gate is open. */
export async function syncNow(
  scope: VenueScope,
  services: IntegrationServices,
): Promise<IntegrationActionResult> {
  if (!scope.canManage) return fail('not_allowed')
  const source = await loadVenueSource(scope)
  if (source === null) return fail('not_ready')
  const { integration, link, connector } = source
  const activeJob = await readActiveJob(scope.pool, scope.tenantId, integration, scope.venue.id)
  const gate = syncGate({
    canManage: scope.canManage,
    integration: {
      hasCredentials: integration.credentialsSealed !== null,
      status: integration.status as IntegrationStatus,
    },
    venueLinked: true,
    menuKnown: connector.canPull(link),
    activeJob,
  })
  if (!gate.enabled) return fail(gate.reason === 'busy' ? 'already_running' : 'not_ready')
  try {
    const id = await connector.queuePull(services.enqueue, {
      tenantId: scope.tenantId,
      integrationId: integration.id,
      venueId: scope.venue.id,
    })
    return id === null ? fail('already_running') : { ok: true }
  } catch (error) {
    logError('integration_sync_not_queued', error)
    return fail('queue_unavailable')
  }
}
