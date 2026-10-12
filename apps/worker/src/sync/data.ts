// What the sync reads from the database. All reads go through `withTenant` (a READ ONLY
// transaction scoped to one tenant, row-level security on); every write goes through
// `@restro/core/apply`.

import {
  fieldValues,
  jobRuns,
  sourceLinks,
  sourceRecords,
  barsyVenues as venueLinks,
  venues,
  withTenant,
} from '@restro/db'
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { SyncEnvironment } from './context'
import { SyncError } from './errors'

/** A venue of ours mapped to a till venue (`bid`), with what its sync reads per venue. */
export interface MappedVenue {
  readonly venueId: string
  readonly bid: number
  /** The menu category the picker of before D88 chose (D56); null when none was. Only the hint
   * for which menu an older venue keeps; the roots below are what the sync reads. */
  readonly catalogueRootCatId: number | null
  /** The roots the till designates (D88): the public menu's category and the till tree's. */
  readonly publicCatId: number | null
  readonly treeCatId: number | null
  /** The catalogue the till venue sells from (CF-16); null until the venue list was read. */
  readonly catalogueId: number | null
  /** Its own price setting (D73); null: the integration's. */
  readonly priceSource: string | null
  /** IANA zone barsy's offset-less timestamps are read in (Q60). */
  readonly timezone: string
  /**
   * `venues.settings` of the venue: where its own publishing rules are (CF-09b), asked with
   * `venueHoldsNewItems`. Opaque here, since only core's readers know its shape.
   */
  readonly venueSettings: unknown
}

/** A mapped venue with its roots: what a pull reads, one menu per root (D88). */
export interface VenueTarget extends MappedVenue {
  /** The roots in order: the public menu first (live by default), then the till tree. */
  readonly roots: readonly number[]
}

/**
 * The roots of a venue, the public menu first, each once; without any, the picker's choice of
 * before D88 (a venue mapped before the venue list was read again).
 */
export function rootsOf(
  publicCatId: number | null,
  treeCatId: number | null,
  legacyRoot: number | null,
): number[] {
  const roots = [
    ...new Set([publicCatId, treeCatId].filter((root): root is number => root !== null)),
  ]
  if (roots.length === 0 && legacyRoot !== null) return [legacyRoot]
  return roots
}

/** Why a queued sync is skipped instead of run: the venue is gone, deleted, or no longer linked. */
export type SyncSkipReason = 'venue_missing' | 'venue_archived' | 'venue_not_linked'

/** The line a skipped sync leaves in the log. */
export const SYNC_SKIP_TEXT: Record<SyncSkipReason, string> = {
  venue_missing: 'sync skipped: this venue does not exist',
  venue_archived: 'sync skipped: this venue was deleted',
  venue_not_linked: 'sync skipped: this venue is not linked to a venue of the till (any more)',
}

/**
 * Whether a queued sync for one of our venues may run (D76): the venue exists, is not deleted and
 * is still linked to a till venue of this integration. The check runs before anything is recorded
 * or asked of the till, so a sync queued before a deletion, or before the link was released, ends
 * without a write and without a failure. Returns the reason when it may not.
 */
export async function syncSkipReason(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  venueId: string,
): Promise<SyncSkipReason | null> {
  const [row] = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({
        archivedAt: venues.archivedAt,
        linked: sql<boolean>`exists (
          select 1 from ${venueLinks}
          where ${venueLinks.venueId} = ${venues.id} and ${venueLinks.integrationId} = ${integrationId})`,
      })
      .from(venues)
      .where(eq(venues.id, venueId)),
  )
  if (row === undefined) return 'venue_missing'
  if (row.archivedAt !== null) return 'venue_archived'
  return row.linked ? null : 'venue_not_linked'
}

/** The venue's link to its till venue; throws `venue_not_mapped` when it has none. */
export async function loadMappedVenue(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  venueId: string,
): Promise<MappedVenue> {
  const [row] = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({
        bid: venueLinks.bid,
        root: venueLinks.catalogueRootCatId,
        publicCatId: venueLinks.publicCatId,
        treeCatId: venueLinks.treeCatId,
        catalogueId: venueLinks.catalogueId,
        priceSource: venueLinks.priceSource,
        timezone: venues.timezone,
        venueSettings: venues.settings,
      })
      .from(venueLinks)
      .innerJoin(venues, eq(venues.id, venueLinks.venueId))
      .where(
        and(
          eq(venueLinks.integrationId, integrationId),
          eq(venueLinks.venueId, venueId),
          // A deleted venue is never synced (D76); its link is released with it, this is the
          // second line.
          isNull(venues.archivedAt),
        ),
      ),
  )
  if (!row) {
    throw new SyncError('venue_not_mapped', 'This venue is not mapped to a venue of the till.')
  }
  return {
    venueId,
    bid: row.bid,
    catalogueRootCatId: row.root,
    publicCatId: row.publicCatId,
    treeCatId: row.treeCatId,
    catalogueId: row.catalogueId,
    priceSource: row.priceSource,
    timezone: row.timezone,
    venueSettings: row.venueSettings,
  }
}

export async function loadVenueTarget(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  venueId: string,
): Promise<VenueTarget> {
  const mapped = await loadMappedVenue(env, tenantId, integrationId, venueId)
  const roots = rootsOf(mapped.publicCatId, mapped.treeCatId, mapped.catalogueRootCatId)
  if (roots.length === 0) {
    throw new SyncError(
      'venue_not_mapped',
      'This venue is mapped to a barsy venue whose menu roots are not known yet (the venue list has not been read).',
    )
  }
  return { ...mapped, roots }
}

/** Our venues mapped to till venues of this integration that sell from `catalogueId`. */
export async function venuesOnCatalogue(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  catalogueId: number,
): Promise<string[]> {
  const rows = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({ venueId: venueLinks.venueId })
      .from(venueLinks)
      .innerJoin(venues, eq(venues.id, venueLinks.venueId))
      .where(
        and(
          eq(venueLinks.integrationId, integrationId),
          eq(venueLinks.catalogueId, catalogueId),
          isNotNull(venueLinks.venueId),
          // A deleted venue is not published after a pull (D76).
          isNull(venues.archivedAt),
        ),
      ),
  )
  return rows.flatMap((row) => (row.venueId === null ? [] : [row.venueId]))
}

/**
 * Every section link of the integration with the menu its section sits in (the root of its parent
 * chain; null when none is found). Decides a venue's section keys and its own sections (CF-16).
 */
export async function readSectionOwners(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
): Promise<{ externalId: string; menuId: string | null }[]> {
  const result = await withTenant(env.pool, tenantId, (tx) =>
    tx.execute<{ external_id: string; menu_id: string | null }>(sql`
      with recursive up as (
        select l.external_id, n.id, n.parent_id
        from restro.source_links l join restro.nodes n on n.id = l.node_id
        where l.integration_id = ${integrationId} and l.external_type = 'category'
        union
        select up.external_id, n.id, n.parent_id
        from up join restro.nodes n on n.id = up.parent_id
      )
      select l.external_id, top.id as menu_id
      from restro.source_links l
      left join up top on top.external_id = l.external_id and top.parent_id is null
      where l.integration_id = ${integrationId} and l.external_type = 'category'`),
  )
  return result.rows.map((row) => ({ externalId: row.external_id, menuId: row.menu_id ?? null }))
}

/**
 * The catalogue of every article link: the `menu_id` of the record its link names (`last_hash`).
 * Null when no record names one: such a link is never concluded absent per catalogue (CF-16).
 */
export async function readArticleCatalogues(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
): Promise<Map<string, number | null>> {
  const result = await withTenant(env.pool, tenantId, (tx) =>
    tx.execute<{ external_id: string; catalogue: string | null }>(sql`
      select l.external_id, (
        select r.payload ->> 'menu_id' from restro.source_records r
        where r.integration_id = l.integration_id and r.external_type = 'article'
          and r.external_id = l.external_id and r.content_hash = l.last_hash
        limit 1
      ) as catalogue
      from restro.source_links l
      where l.integration_id = ${integrationId} and l.external_type = 'article'`),
  )
  const catalogues = new Map<string, number | null>()
  for (const row of result.rows) {
    const text = row.catalogue
    catalogues.set(row.external_id, text !== null && /^\d{1,9}$/.test(text) ? Number(text) : null)
  }
  return catalogues
}

/** The articles (external ids) whose items are placed in a section of any of these menus. */
export async function readMenuArticles(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  menuIds: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>()
  for (const menuId of menuIds) {
    const result = await withTenant(env.pool, tenantId, (tx) =>
      tx.execute<{ external_id: string }>(sql`
        with recursive sections as (
          select n.id from restro.nodes n where n.parent_id = ${menuId} and n.node_type = 'section'
          union
          select n.id from restro.nodes n join sections s on n.parent_id = s.id
          where n.node_type = 'section'
        )
        select distinct l.external_id
        from restro.source_links l
        join restro.placements p on p.item_id = l.node_id
        join sections s on s.id = p.section_id
        where l.integration_id = ${integrationId} and l.external_type = 'article'`),
    )
    for (const row of result.rows) found.add(row.external_id)
  }
  return found
}

/** The articles this venue hides (till `visible = false` at its scope: outside its root, CF-16). */
export async function readVenueHidden(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  venueId: string,
): Promise<Set<string>> {
  const rows = await withTenant(env.pool, tenantId, (tx) =>
    tx
      .select({ externalId: sourceLinks.externalId })
      .from(sourceLinks)
      .innerJoin(
        fieldValues,
        and(
          eq(fieldValues.nodeId, sourceLinks.nodeId),
          eq(fieldValues.fieldKey, 'visible'),
          eq(fieldValues.layer, 'till'),
          eq(fieldValues.scope, `venue:${venueId}`),
          eq(fieldValues.valid, true),
          sql`${fieldValues.value} = 'false'::jsonb`,
        ),
      )
      .where(
        and(eq(sourceLinks.integrationId, integrationId), eq(sourceLinks.externalType, 'article')),
      ),
  )
  return new Set(rows.map((row) => row.externalId))
}

/** The id of the record each article link names (by its `last_hash`), for the articles asked. */
export async function recordIdsOfLinks(
  env: SyncEnvironment,
  tenantId: string,
  integrationId: string,
  externalIds: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  const unique = [...new Set(externalIds)]
  for (let start = 0; start < unique.length; start += 500) {
    const rows = await withTenant(env.pool, tenantId, (tx) =>
      tx
        .select({ externalId: sourceLinks.externalId, recordId: sourceRecords.id })
        .from(sourceLinks)
        .innerJoin(
          sourceRecords,
          and(
            eq(sourceRecords.integrationId, sourceLinks.integrationId),
            eq(sourceRecords.externalType, sourceLinks.externalType),
            eq(sourceRecords.externalId, sourceLinks.externalId),
            eq(sourceRecords.contentHash, sourceLinks.lastHash),
          ),
        )
        .where(
          and(
            eq(sourceLinks.integrationId, integrationId),
            eq(sourceLinks.externalType, 'article'),
            inArray(sourceLinks.externalId, unique.slice(start, start + 500)),
          ),
        ),
    )
    for (const row of rows) if (!found.has(row.externalId)) found.set(row.externalId, row.recordId)
  }
  return found
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

/** External ids of the articles whose item already has a till-layer photo. */
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
          eq(fieldValues.layer, 'till'),
        ),
      )
      .where(
        and(eq(sourceLinks.integrationId, integrationId), eq(sourceLinks.externalType, 'article')),
      ),
  )
  return new Set(rows.map((row) => row.externalId))
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
