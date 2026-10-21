// What the barsy sync keeps in `integrations.config`, per barsy venue (`bid`): the incremental
// cursor, the hash of the last public category tree, and the cached tree for the catalogue-root
// picker (S2-05). Config, not a column, so no migration: the keys are written atomically (one
// `UPDATE` per key, merged inside Postgres), so two venues' runs never overwrite each other.
//
// Stored values are snake_case (convention). The cursor is an instant (ISO 8601 with an offset);
// the worker turns it into the venue-local text barsy's `last_update` filter expects.

import { type DbPool, integrations } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { isId } from '../ids'
import { type SyncSettingsInput, SyncSettingsInputSchema } from '../sync-settings'
import { ProvisionError } from './provision'

const IsoInstant = z.iso.datetime({ offset: true })
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/)

/** The sync bookkeeping of one barsy venue. */
export const SyncStateSchema = z.object({
  /** Start of the last successful run (full or incremental). Advances only after success. */
  cursor: IsoInstant.optional(),
  /** SHA-256 of the last public category tree a successful run saw. */
  tree_hash: Sha256.optional(),
  /**
   * SHA-256 of the scope the last successful complete full pull read: the barsy venue, the menu
   * category and the mapping settings it used (B1-Q2). The incremental compares it with the
   * scope as configured now: a difference queues a full pull instead of a partial one against
   * the new scope. Absent on state written before it existed, which counts as changed.
   */
  scope_hash: Sha256.optional(),
  last_full_pull_at: IsoInstant.optional(),
  last_incremental_at: IsoInstant.optional(),
  // The minute tick's own marks (S3-04). Without them a change check that failed, or a full pull
  // that was not complete, would count as "never ran" and be queued again every minute.
  /** When the tick last queued a change check. */
  last_incremental_queued_at: IsoInstant.optional(),
  /** The full-pull slot (an instant) the tick last queued a full pull for. */
  last_full_pull_slot: IsoInstant.optional(),
  // The tables of the venue (brief CF-16, T67): read once the venue is mapped, root or not.
  /** When the venue's tables were last read successfully (a full pull or a places read). */
  places_read_at: IsoInstant.optional(),
  /** When the tick last queued a places read (so a failed one is asked for again later, not every minute). */
  places_queued_at: IsoInstant.optional(),
})
export type SyncState = z.output<typeof SyncStateSchema>

/** The public category tree of one barsy venue, reduced to what the root picker needs. */
export const CachedTreeSchema = z.object({
  fetched_at: IsoInstant,
  categories: z.array(
    z.object({
      cat_id: z.int(),
      parent_id: z.int().nullable(),
      /** The public name when there is one, else the internal one. */
      name: z.string(),
    }),
  ),
})
export type CachedTree = z.output<typeof CachedTreeSchema>

const SyncConfigSchema = z.object({
  sync: z.record(z.string(), SyncStateSchema).optional(),
  catalogue_trees: z.record(z.string(), CachedTreeSchema).optional(),
})

/** The sync state of `bid` in an integration's `config` (empty when there is none or it is unreadable). */
export function readSyncState(config: unknown, bid: number | string): SyncState {
  const parsed = SyncConfigSchema.safeParse(config)
  return parsed.success ? (parsed.data.sync?.[String(bid)] ?? {}) : {}
}

/** The cached category tree of `bid`, or null. */
export function readCachedTree(config: unknown, bid: number | string): CachedTree | null {
  const parsed = SyncConfigSchema.safeParse(config)
  return parsed.success ? (parsed.data.catalogue_trees?.[String(bid)] ?? null) : null
}

function check(tenantId: string, integrationId: string, bid: number): void {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('in', integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  if (!Number.isSafeInteger(bid) || bid < 0) {
    throw new ProvisionError('invalid_input', 'bid must be a non-negative integer')
  }
}

/**
 * Merges `patch` into the sync state of one barsy venue and returns whether the integration
 * exists. Atomic: `config.sync.<bid>` is merged inside one `UPDATE`.
 */
export async function updateSyncState(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  patch: SyncState,
): Promise<boolean> {
  check(tenantId, integrationId, bid)
  const parsed = SyncStateSchema.strict().safeParse(patch)
  if (!parsed.success) throw new ProvisionError('invalid_input', z.prettifyError(parsed.error))
  const key = String(bid)
  const merged = JSON.stringify({ [key]: parsed.data })
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(integrations)
      .set({
        config: sql`${integrations.config} || jsonb_build_object('sync',
          coalesce(${integrations.config} -> 'sync', '{}'::jsonb) || jsonb_build_object(${key}::text,
            coalesce(${integrations.config} -> 'sync' -> ${key}::text, '{}'::jsonb) || (${merged}::jsonb -> ${key}::text)))`,
      })
      .where(eq(integrations.id, integrationId))
      .returning({ id: integrations.id })
    return rows.length > 0
  })
}

/** Replaces the cached category tree of one barsy venue. Returns whether the integration exists. */
export async function storeCachedTree(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  tree: CachedTree,
): Promise<boolean> {
  check(tenantId, integrationId, bid)
  const parsed = CachedTreeSchema.safeParse(tree)
  if (!parsed.success) throw new ProvisionError('invalid_input', z.prettifyError(parsed.error))
  const key = String(bid)
  const value = JSON.stringify(parsed.data)
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(integrations)
      .set({
        config: sql`${integrations.config} || jsonb_build_object('catalogue_trees',
          coalesce(${integrations.config} -> 'catalogue_trees', '{}'::jsonb) ||
            jsonb_build_object(${key}::text, ${value}::jsonb))`,
      })
      .where(eq(integrations.id, integrationId))
      .returning({ id: integrations.id })
    return rows.length > 0
  })
}

/**
 * The stored `config.publish` as an object. A `publish` that is not an object (a hand-edited
 * config) counts as empty, so it is replaced rather than extended.
 */
const storedPublish =
  () => sql`case when jsonb_typeof(${integrations.config} -> 'publish') = 'object'
  then ${integrations.config} -> 'publish' else '{}'::jsonb end`

/**
 * The stored `config.schedule.time_zone`, as a one-key object to merge (or an empty one): the
 * form does not send the zone (the page names it, read-only), so a save must not drop it.
 */
const storedTimeZone =
  () => sql`case when jsonb_typeof(${integrations.config} #> '{schedule,time_zone}') = 'string'
  then jsonb_build_object('time_zone', ${integrations.config} #> '{schedule,time_zone}')
  else '{}'::jsonb end`

/**
 * Saves the automatic-sync form (D59, Settings -> Integrations): `config.schedule` is replaced
 * with the form's schedule (keeping a stored `time_zone`, which the form does not send). Since
 * CF-09b (D73) the publishing rules are per venue and this never touches `config.publish` or the
 * flat key `publish_after_sync` of S3-01b: they stay as what a venue without rules of its own
 * inherits (`venuePublishRules`). Returns whether the integration exists.
 *
 * One atomic `UPDATE`, merged inside Postgres: `publish.auto_paused`, which the Publish tab sets
 * after a rollback and a manual publish clears, is never read or written here, so a pause set or
 * cleared while the form was open (or between this call's read and write, if it had one) is
 * neither lost nor revived. The same goes for every other key of the config.
 */
export async function saveSyncSettingsConfig(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  settings: SyncSettingsInput,
): Promise<boolean> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('in', integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  const parsed = SyncSettingsInputSchema.safeParse(settings)
  if (!parsed.success) throw new ProvisionError('invalid_input', z.prettifyError(parsed.error))
  const schedule = JSON.stringify(parsed.data.schedule)
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(integrations)
      .set({
        config: sql`${integrations.config} || jsonb_build_object(
            'schedule', ${schedule}::jsonb || ${storedTimeZone()})`,
      })
      .where(eq(integrations.id, integrationId))
      .returning({ id: integrations.id })
    return rows.length > 0
  })
}

// --- the venues of the till nobody wants as a venue ("Not used", CF-09b, D73) --------------------

const NotUsedSchema = z.record(z.string(), z.literal(true))

/**
 * The till venues (by their number in the till) marked "Not used": a shop, a catering unit,
 * "Services". Stored in the integration's config as `not_used: { "<bid>": true }`, so it needs no
 * migration and two marks never overwrite each other. Empty when there is none or it is unreadable.
 */
export function readNotUsedVenues(config: unknown): ReadonlySet<number> {
  const stored = (config as { not_used?: unknown } | null | undefined)?.not_used
  const parsed = NotUsedSchema.safeParse(stored)
  if (!parsed.success) return new Set()
  return new Set(
    Object.keys(parsed.data)
      .map(Number)
      .filter((bid) => Number.isSafeInteger(bid) && bid >= 0),
  )
}

/**
 * Marks a till venue "Not used" (`true`) or takes the mark off (`false`). One atomic `UPDATE`
 * merged inside Postgres. Returns whether the integration exists. Whether the till venue exists
 * and is unlinked is the caller's check.
 */
export async function setTillVenueNotUsed(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  bid: number,
  notUsed: boolean,
): Promise<boolean> {
  check(tenantId, integrationId, bid)
  const key = String(bid)
  const stored = sql`case when jsonb_typeof(${integrations.config} -> 'not_used') = 'object'
    then ${integrations.config} -> 'not_used' else '{}'::jsonb end`
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(integrations)
      .set({
        config: notUsed
          ? sql`${integrations.config} || jsonb_build_object('not_used',
              ${stored} || jsonb_build_object(${key}::text, true))`
          : sql`${integrations.config} || jsonb_build_object('not_used', ${stored} - ${key}::text)`,
      })
      .where(eq(integrations.id, integrationId))
      .returning({ id: integrations.id })
    return rows.length > 0
  })
}

/**
 * Pauses (`true`) or resumes (`false`) automatic publishing of an integration (brief S3-05): sets
 * or removes `config.publish.auto_paused`, leaving the other publish settings alone. One `UPDATE`,
 * merged inside Postgres, so it never loses a concurrent change to another key. Returns whether
 * the integration exists. The worker skips automatic publishes while the flag is set
 * (`autoPublishPaused`); a manual publish clears it.
 */
export async function setAutoPublishPaused(
  pool: DbPool,
  tenantId: string,
  integrationId: string,
  paused: boolean,
): Promise<boolean> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('in', integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  const publish = storedPublish()
  return withTenantWrite(pool, tenantId, async (tx) => {
    const rows = await tx
      .update(integrations)
      .set({
        config: paused
          ? sql`${integrations.config} || jsonb_build_object('publish',
              ${publish} || '{"auto_paused": true}'::jsonb)`
          : sql`case when ${integrations.config} #> '{publish,auto_paused}' is null
              then ${integrations.config}
              else ${integrations.config} || jsonb_build_object('publish',
                ${publish} - 'auto_paused') end`,
      })
      .where(eq(integrations.id, integrationId))
      .returning({ id: integrations.id })
    return rows.length > 0
  })
}
