// What the sync reads from the database. All reads go through `withTenant` (a READ ONLY
// transaction scoped to one tenant, row-level security on); every write goes through
// `@restro/core/apply`.

import {
  barsyVenues,
  fieldValues,
  jobRuns,
  sourceLinks,
  sourceRecords,
  venues,
  withTenant,
} from '@restro/db'
import { and, count, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import type { SyncEnvironment } from './context'
import { SyncError } from './errors'

/** A venue of ours mapped to a barsy venue with a catalogue root. */
export interface VenueTarget {
  readonly venueId: string
  readonly bid: number
  readonly catalogueRootCatId: number
  /** IANA zone barsy's offset-less timestamps are read in (Q60). */
  readonly timezone: string
  /** How many venues of this integration are mapped and have a catalogue root. */
  readonly mappedVenues: number
}

export async function loadVenueTarget(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  venueId: string,
): Promise<VenueTarget> {
  return withTenant(env.pool, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        bid: barsyVenues.bid,
        root: barsyVenues.catalogueRootCatId,
        timezone: venues.timezone,
      })
      .from(barsyVenues)
      .innerJoin(venues, eq(venues.id, barsyVenues.venueId))
      .where(and(eq(barsyVenues.integrationId, integrationId), eq(barsyVenues.venueId, venueId)))
    if (!row || row.root === null) {
      throw new SyncError(
        'venue_not_mapped',
        'This venue is not mapped to a barsy venue with a catalogue root.',
      )
    }
    const [mapped] = await tx
      .select({ total: count() })
      .from(barsyVenues)
      .where(
        and(
          eq(barsyVenues.integrationId, integrationId),
          isNotNull(barsyVenues.venueId),
          isNotNull(barsyVenues.catalogueRootCatId),
        ),
      )
    return {
      venueId,
      bid: row.bid,
      catalogueRootCatId: row.root,
      timezone: row.timezone,
      mappedVenues: mapped?.total ?? 1,
    }
  })
}

/** A stored link, as the sync needs it. */
export interface StoredLink {
  readonly externalType: string
  readonly externalId: string
  readonly state: 'active' | 'missing' | 'deleted'
  readonly stateChangedAt: Date
  readonly lastSeenAt: Date
  readonly lastHash: string | null
}

export const linkKeyOf = (link: { externalType: string; externalId: string }) =>
  `${link.externalType}:${link.externalId}`

/** Every source link of the integration, by `<externalType>:<externalId>`. */
export async function readLinks(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
): Promise<Map<string, StoredLink>> {
  const rows = await withTenant(env.pool, tenantId, (tx) =>
    tx.select().from(sourceLinks).where(eq(sourceLinks.integrationId, integrationId)),
  )
  return new Map(
    rows.map((row) => [
      linkKeyOf(row),
      {
        externalType: row.externalType,
        externalId: row.externalId,
        state: row.state as StoredLink['state'],
        stateChangedAt: row.stateChangedAt,
        lastSeenAt: row.lastSeenAt,
        lastHash: row.lastHash,
      },
    ]),
  )
}

/**
 * The barsy picture each article had when it was last recorded: `content hash → picture name`
 * (null when it had none). Used to tell a changed picture from an unchanged one.
 */
export async function picturesOfRecords(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  hashes: readonly string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (hashes.length === 0) return result
  const unique = [...new Set(hashes)]
  for (let start = 0; start < unique.length; start += 500) {
    const rows = await withTenant(env.pool, tenantId, (tx) =>
      tx
        .select({
          hash: sourceRecords.contentHash,
          picture: sql<string | null>`${sourceRecords.payload} ->> 'picture'`,
        })
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.integrationId, integrationId),
            eq(sourceRecords.externalType, 'article'),
            inArray(sourceRecords.contentHash, unique.slice(start, start + 500)),
          ),
        ),
    )
    for (const row of rows) result.set(row.hash, row.picture)
  }
  return result
}

/** External ids of the articles whose item already has a barsy-layer photo. */
export async function articlesWithPhoto(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
): Promise<Set<string>> {
  const rows = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .selectDistinct({ externalId: sourceLinks.externalId })
      .from(sourceLinks)
      .innerJoin(
        fieldValues,
        and(
          eq(fieldValues.nodeId, sourceLinks.nodeId),
          eq(fieldValues.fieldKey, 'image'),
          eq(fieldValues.layer, 'barsy'),
        ),
      )
      .where(
        and(eq(sourceLinks.integrationId, integrationId), eq(sourceLinks.externalType, 'article')),
      ),
  )
  return new Set(rows.map((row) => row.externalId))
}

/** How long a "running" job run is believed: a crashed worker leaves it behind. */
const RUNNING_RUN_MAX_AGE_MS = 60 * 60 * 1000

/** True while a full pull of this integration is running (started within the last hour). */
export async function fullPullIsRunning(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
): Promise<boolean> {
  const since = new Date(env.now().getTime() - RUNNING_RUN_MAX_AGE_MS)
  const rows = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.integrationId, integrationId),
          eq(jobRuns.kind, 'barsy_full_pull'),
          eq(jobRuns.status, 'running'),
          gte(jobRuns.startedAt, since),
        ),
      )
      .limit(1),
  )
  return rows.length > 0
}

/** True if a full pull of this integration started within `withinMs` (whatever its outcome). */
export async function fullPullStartedWithin(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  withinMs: number,
): Promise<boolean> {
  const since = new Date(env.now().getTime() - withinMs)
  const rows = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.integrationId, integrationId),
          eq(jobRuns.kind, 'barsy_full_pull'),
          gte(jobRuns.startedAt, since),
        ),
      )
      .limit(1),
  )
  return rows.length > 0
}
