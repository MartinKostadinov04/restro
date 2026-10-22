// The purge (D83, D96, D91): the only code that erases rows, through the role `restro_purge`
// (`@restro/db/purge`; dependency-cruiser lets nothing else import it). Two jobs:
//
//   purge-venue   a deleted venue, now ("Delete permanently"): its own rows go (areas, tables,
//                 routes, menus with their sections, the items only its menus placed, its values
//                 and change log, tags, versions, address names, the venue row), its public code
//                 and table codes are tombstoned (never reissued; a code by its hash since #70),
//                 its files are taken off the
//                 CDN and the organisation's index written again. Items the till or another
//                 venue still uses stay.
//   purge-tick    daily: what is due in every organisation: venues 30 days in the bin, binned
//                 menus, POS instances removed 30 days ago (D91: their till layer, records and
//                 links, the items that came only from them and no menu places, their sections
//                 that sit in no menu any more),
//                 deleted areas and tables, versions past the rule in ../../core's
//                 `versionsToPurge`, the change log past two months.
//
// Every purge is one transaction on the purge role, scoped to the tenant (row-level security
// applies to that role as to the app's), and ends with a content-free `purge_log` row. The files
// go after the transaction committed: a file that outlives a failed purge is harmless (nothing
// in the database names it any more after the next successful run), a row that outlives a
// removed file would not be. The job runs are recorded on the app pool like every other job's.
//
// The purge pool is opened for the run and closed after it: a purge is rare, and the worker
// holds no idle connection as the role that may delete.
import {
  currentPath,
  livePath,
  type PublishStore,
  snapshotPath,
  tableTokenPath,
  venueIndexPath,
} from '@restro/assets'
import {
  CHANGE_LOG_DAYS,
  cutoff,
  INSTANCE_BIN_DAYS,
  isDue,
  JOB_NAMES,
  MENU_BIN_DAYS,
  type NodeId,
  type PurgeVenueJob,
  PurgeVenueJobSchema,
  type SnapshotId,
  TABLE_BIN_DAYS,
  tillSource,
  VENUE_BIN_DAYS,
  type VenueId,
  type VersionRow,
  versionsToPurge,
} from '@restro/core'
import { codeFileNames, venueServesTill } from '@restro/core/apply'
import {
  areas,
  authOrganization,
  createPool,
  type DbPool,
  events,
  fieldValues,
  integrations,
  itemFirstPublished,
  jobRuns,
  menuRoutes,
  menus,
  nodes,
  placements,
  places,
  publishPointers,
  purgeLog,
  snapshots,
  sourceLinks,
  sourceRecords,
  tags,
  tombstones,
  venueSlugHistory,
  venues,
  venueTables,
  withSystem,
  withTenant,
} from '@restro/db'
import { type PurgeTx, withTenantPurge } from '@restro/db/purge'
import { and, eq, inArray, isNotNull, isNull, lt, lte, notExists, sql } from 'drizzle-orm'
import type { Job } from 'pg-boss'
import type { z } from 'zod'

import { tillVenueLinks } from '../connectors'
import { writeOrganizationIndex } from '../publish/organization-index'
import { type RunReport, trackedRun } from '../sync/run'
import { defineJob, type JobDefinition, type WorkerContext } from './types'

export interface PurgeJobDeps {
  /** Connection string of the purge role (DATABASE_URL_PURGE). */
  readonly purgeDatabaseUrl: string
  readonly publishStore: PublishStore
}

/** Rows deleted per table in one purge; what the purge log records. */
type Counts = Record<string, number>

function count(counts: Counts, table: string, rows: readonly unknown[]): void {
  counts[table] = (counts[table] ?? 0) + rows.length
}

/** The ids of a node tree under `roots` (sections, groups, options; items hang off nothing). */
async function subtreeOf(tx: PurgeTx, roots: readonly string[]): Promise<string[]> {
  if (roots.length === 0) return []
  const list = sql.join(
    roots.map((id) => sql`${id}`),
    sql`, `,
  )
  const result = await tx.execute<{ id: string }>(sql`
    with recursive tree as (
      select id from restro.nodes where id in (${list})
      union all
      select n.id from restro.nodes n join tree on n.parent_id = tree.id
    )
    select id from tree`)
  return result.rows.map((row) => row.id)
}

/**
 * Erases the nodes `ids` with everything that hangs on them: values, change log, source links,
 * placements, first-published marks, the rows themselves (children and parents in one statement:
 * the parent key is checked at its end).
 */
async function deleteNodes(tx: PurgeTx, ids: readonly string[], counts: Counts): Promise<void> {
  if (ids.length === 0) return
  count(
    counts,
    'field_values',
    await tx
      .delete(fieldValues)
      .where(inArray(fieldValues.nodeId, ids))
      .returning({ id: fieldValues.nodeId }),
  )
  count(
    counts,
    'events',
    await tx.delete(events).where(inArray(events.nodeId, ids)).returning({ id: events.seq }),
  )
  count(
    counts,
    'source_links',
    await tx
      .delete(sourceLinks)
      .where(inArray(sourceLinks.nodeId, ids))
      .returning({ id: sourceLinks.nodeId }),
  )
  count(
    counts,
    'placements',
    await tx
      .delete(placements)
      .where(inArray(placements.itemId, ids))
      .returning({ id: placements.itemId }),
  )
  count(
    counts,
    'item_first_published',
    await tx
      .delete(itemFirstPublished)
      .where(inArray(itemFirstPublished.nodeId, ids))
      .returning({ id: itemFirstPublished.nodeId }),
  )
  count(
    counts,
    'nodes',
    await tx.delete(nodes).where(inArray(nodes.id, ids)).returning({ id: nodes.id }),
  )
}

/**
 * Erases the menus `menuIds` (their rows must already be free of pointers and snapshots): the
 * placements in their sections, the items those sections alone placed (no other placement, no
 * source link: nobody else's), the sections and roots, the menu rows.
 */
async function deleteMenus(
  tx: PurgeTx,
  menuRows: readonly { id: string; rootNodeId: string }[],
  counts: Counts,
): Promise<void> {
  if (menuRows.length === 0) return
  const tree = await subtreeOf(
    tx,
    menuRows.map((menu) => menu.rootNodeId),
  )
  const placed = await tx
    .selectDistinct({ itemId: placements.itemId })
    .from(placements)
    .where(inArray(placements.sectionId, tree))
  count(
    counts,
    'placements',
    await tx
      .delete(placements)
      .where(inArray(placements.sectionId, tree))
      .returning({ id: placements.itemId }),
  )
  const candidates = placed.map((row) => row.itemId)
  let orphans: string[] = []
  if (candidates.length > 0) {
    const stillPlaced = new Set(
      (
        await tx
          .selectDistinct({ itemId: placements.itemId })
          .from(placements)
          .where(inArray(placements.itemId, candidates))
      ).map((row) => row.itemId),
    )
    const linked = new Set(
      (
        await tx
          .selectDistinct({ nodeId: sourceLinks.nodeId })
          .from(sourceLinks)
          .where(inArray(sourceLinks.nodeId, candidates))
      ).map((row) => row.nodeId),
    )
    orphans = candidates.filter((id) => !stillPlaced.has(id) && !linked.has(id))
  }
  const orphanTree = await subtreeOf(tx, orphans)
  count(
    counts,
    'menus',
    await tx
      .delete(menus)
      .where(
        inArray(
          menus.id,
          menuRows.map((menu) => menu.id),
        ),
      )
      .returning({ id: menus.id }),
  )
  await deleteNodes(tx, [...tree, ...orphanTree], counts)
}

/** Erases the versions `snapshotIds` of one menu + venue (rollback records go in the same statement). */
async function deleteSnapshots(
  tx: PurgeTx,
  snapshotIds: readonly string[],
  counts: Counts,
): Promise<void> {
  if (snapshotIds.length === 0) return
  count(
    counts,
    'snapshots',
    await tx
      .delete(snapshots)
      .where(inArray(snapshots.id, snapshotIds))
      .returning({ id: snapshots.id }),
  )
}

/** Tombstones the codes `values` (D83): a value already there (purged twice) is left as it is. */
async function tombstone(
  tx: PurgeTx,
  organizationId: string,
  kind: 'public_code' | 'table_token',
  values: readonly string[],
): Promise<void> {
  if (values.length === 0) return
  await tx
    .insert(tombstones)
    .values(values.map((value) => ({ kind, value, organizationId })))
    .onConflictDoNothing()
}

async function logPurge(
  tx: PurgeTx,
  tenantId: string,
  kind: 'venue' | 'menu' | 'instance' | 'versions' | 'tables',
  subjectId: string,
  counts: Counts,
): Promise<void> {
  await tx.insert(purgeLog).values({ tenantId, kind, subjectId, counts })
}

export type PurgeVenueResult =
  | { readonly status: 'missing' }
  /** The venue is not in the bin: nothing is erased (a purge needs a deletion first, D83). */
  | { readonly status: 'not_deleted' }
  /** The venue still serves a till venue: the link is released by a deletion; nothing is erased. */
  | { readonly status: 'still_linked' }
  | {
      readonly status: 'purged'
      readonly counts: Counts
      /** The table codes tombstoned, by their hashes. */
      readonly tokens: readonly string[]
      readonly publicId: string
      /** Files taken off the publish store. */
      readonly filesRemoved: number
    }

/** Erases one deleted venue (see the header). The files go once the rows are gone. */
export async function purgeVenue(
  deps: { readonly purgePool: DbPool; readonly pool: DbPool; readonly store: PublishStore },
  input: { readonly tenantId: string; readonly venueId: string },
): Promise<PurgeVenueResult> {
  const { tenantId, venueId } = input
  const erased = await withTenantPurge(deps.purgePool, tenantId, async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.id, venueId))
    if (venue === undefined) return { status: 'missing' } as const
    if (venue.archivedAt === null) return { status: 'not_deleted' } as const
    if (await venueServesTill(tx, venueId)) return { status: 'still_linked' } as const

    const counts: Counts = {}
    const codes = await tx
      .select({ qrToken: venueTables.qrToken, qrCodeHash: venueTables.qrCodeHash })
      .from(venueTables)
      .where(and(eq(venueTables.venueId, venueId), isNotNull(venueTables.qrCodeHash)))
    const tokens = codes.flatMap((row) => (row.qrCodeHash === null ? [] : [row.qrCodeHash]))
    const menuRows = await tx
      .select({ id: menus.id, rootNodeId: menus.rootNodeId })
      .from(menus)
      .where(eq(menus.venueId, venueId))
    const snapshotIds = (
      await tx.select({ id: snapshots.id }).from(snapshots).where(eq(snapshots.venueId, venueId))
    ).map((row) => row.id)

    count(
      counts,
      'menu_routes',
      await tx
        .delete(menuRoutes)
        .where(eq(menuRoutes.venueId, venueId))
        .returning({ id: menuRoutes.venueId }),
    )
    count(
      counts,
      'tables',
      await tx
        .delete(venueTables)
        .where(eq(venueTables.venueId, venueId))
        .returning({ id: venueTables.id }),
    )
    count(
      counts,
      'areas',
      await tx.delete(areas).where(eq(areas.venueId, venueId)).returning({ id: areas.id }),
    )
    count(
      counts,
      'publish_pointers',
      await tx
        .delete(publishPointers)
        .where(eq(publishPointers.venueId, venueId))
        .returning({ id: publishPointers.menuId }),
    )
    count(
      counts,
      'item_first_published',
      await tx
        .delete(itemFirstPublished)
        .where(eq(itemFirstPublished.venueId, venueId))
        .returning({ id: itemFirstPublished.nodeId }),
    )
    await deleteSnapshots(tx, snapshotIds, counts)
    count(
      counts,
      'tags',
      await tx.delete(tags).where(eq(tags.venueId, venueId)).returning({ id: tags.id }),
    )
    // The venue's own values and change log on any node (shared items included: the till's
    // price for this venue is nobody else's).
    const scope = `venue:${venueId}`
    count(
      counts,
      'field_values',
      await tx
        .delete(fieldValues)
        .where(eq(fieldValues.scope, scope))
        .returning({ id: fieldValues.nodeId }),
    )
    count(
      counts,
      'events',
      await tx.delete(events).where(eq(events.scope, scope)).returning({ id: events.seq }),
    )
    await deleteMenus(tx, menuRows, counts)
    count(
      counts,
      'venue_slug_history',
      await tx
        .delete(venueSlugHistory)
        .where(eq(venueSlugHistory.venueId, venueId))
        .returning({ id: venueSlugHistory.slug }),
    )
    count(
      counts,
      'venues',
      await tx.delete(venues).where(eq(venues.id, venueId)).returning({ id: venues.id }),
    )
    await tombstone(tx, tenantId, 'public_code', [venue.publicId])
    await tombstone(tx, tenantId, 'table_token', tokens)
    await logPurge(tx, tenantId, 'venue', venueId, counts)
    return {
      status: 'purged',
      counts,
      tokens,
      codeFiles: codes.flatMap(codeFileNames),
      publicId: venue.publicId,
      menuIds: menuRows.map((menu) => menu.id),
      snapshotIds,
    } as const
  })
  if (erased.status !== 'purged') return erased

  const files = [
    venueIndexPath(erased.publicId),
    ...erased.codeFiles.map(tableTokenPath),
    ...erased.menuIds.flatMap((menuId) => [
      currentPath(menuId as NodeId, venueId as VenueId),
      livePath(menuId as NodeId, venueId as VenueId),
    ]),
    ...erased.snapshotIds.map((id) => snapshotPath(id as SnapshotId)),
  ]
  for (const file of files) await deps.store.delete(file)
  await writeOrganizationIndex({ pool: deps.pool, store: deps.store }, tenantId)
  return {
    status: 'purged',
    counts: erased.counts,
    tokens: erased.tokens,
    publicId: erased.publicId,
    filesRemoved: files.length,
  }
}

/** Erases one binned menu of a venue (D91), with its versions and files; refuses a live or unbinned one. */
export async function purgeMenu(
  deps: { readonly purgePool: DbPool; readonly store: PublishStore },
  input: { readonly tenantId: string; readonly venueId: string; readonly menuId: string },
): Promise<{ status: 'missing' | 'not_binned' | 'purged'; counts?: Counts }> {
  const { tenantId, venueId, menuId } = input
  const erased = await withTenantPurge(deps.purgePool, tenantId, async (tx) => {
    const [menu] = await tx
      .select({ id: menus.id, rootNodeId: menus.rootNodeId, deletedAt: menus.deletedAt })
      .from(menus)
      .where(and(eq(menus.id, menuId), eq(menus.venueId, venueId)))
    if (menu === undefined) return { status: 'missing' } as const
    const [venue] = await tx
      .select({ liveMenuId: venues.liveMenuId })
      .from(venues)
      .where(eq(venues.id, venueId))
    if (menu.deletedAt === null || venue?.liveMenuId === menuId) {
      return { status: 'not_binned' } as const
    }
    const counts: Counts = {}
    const snapshotIds = (
      await tx.select({ id: snapshots.id }).from(snapshots).where(eq(snapshots.menuId, menuId))
    ).map((row) => row.id)
    count(
      counts,
      'publish_pointers',
      await tx
        .delete(publishPointers)
        .where(eq(publishPointers.menuId, menuId))
        .returning({ id: publishPointers.menuId }),
    )
    count(
      counts,
      'item_first_published',
      await tx
        .delete(itemFirstPublished)
        .where(eq(itemFirstPublished.menuId, menuId))
        .returning({ id: itemFirstPublished.nodeId }),
    )
    await deleteSnapshots(tx, snapshotIds, counts)
    await deleteMenus(tx, [menu], counts)
    await logPurge(tx, tenantId, 'menu', menuId, counts)
    return { status: 'purged', counts, snapshotIds } as const
  })
  if (erased.status !== 'purged') return erased
  for (const file of [
    currentPath(menuId as NodeId, venueId as VenueId),
    livePath(menuId as NodeId, venueId as VenueId),
    ...erased.snapshotIds.map((id) => snapshotPath(id as SnapshotId)),
  ]) {
    await deps.store.delete(file)
  }
  return { status: 'purged', counts: erased.counts }
}

/**
 * The instance's items that no section places (D91): roots for `instanceTrees`. Each goes with its
 * modifier groups and options.
 */
const UNPLACED_ITEMS = sql`
  select n.id from restro.nodes n join only_this o on o.id = n.id
  where n.node_type = 'item'
    and not exists (select 1 from restro.placements p where p.item_id = n.id)`

/**
 * The instance's sections that sit in no menu any more: roots for `instanceTrees`. A section's
 * chain of parents ends at a menu's root node; while that menu exists (a binned one too, until
 * its own purge, which takes its sections with it) the section stays, empty or not, and loses
 * only its link. Each goes with everything under it.
 */
const DETACHED_SECTIONS = sql`
  with recursive up as (
    select n.id as start, n.id as at, n.parent_id from restro.nodes n
    join only_this o on o.id = n.id
    where n.node_type = 'section'
    union all
    select u.start, p.id, p.parent_id from up u join restro.nodes p on p.id = u.parent_id
  )
  select u.start as id from up u
  where u.parent_id is null
    and not exists (select 1 from restro.menus m where m.root_node_id = u.at)`

/**
 * The nodes under `roots` (one of the two above), roots included, that a removed instance leaves
 * and nobody uses (D91), as one list for `deleteNodes`. A node is the instance's (`only_this`)
 * when every till link and every till value it has names the instance; a root stays, with all
 * under it, when anything under it came from another instance too. Till values count as well as
 * links: a node kept on an earlier run lost its link but keeps the till values that cite the
 * instance's records, and goes on the first run after nothing uses it, which frees those records.
 * Menus are never roots: a menu goes with its venue or its bin.
 */
async function instanceTrees(
  tx: PurgeTx,
  integrationId: string,
  roots: typeof UNPLACED_ITEMS,
): Promise<string[]> {
  const source = tillSource(integrationId)
  const result = await tx.execute<{ id: string }>(sql`
    with recursive
    origin as (
      select node_id, 'till:' || integration_id as source from restro.source_links
      union all
      select node_id, source from restro.field_values where layer = 'till'
    ),
    only_this as (
      select node_id as id from origin
      where node_id in (select node_id from origin where source = ${source})
      group by node_id
      having bool_and(source = ${source})
    ),
    roots as (${roots}),
    tree as (
      select r.id as root, r.id from roots r
      union all
      select t.root, c.id from restro.nodes c join tree t on c.parent_id = t.id
    )
    select t.id from tree t
    where t.root not in (
      select k.root from tree k join origin g on g.node_id = k.id where g.source <> ${source}
    )`)
  return result.rows.map((row) => row.id)
}

export type PurgeInstanceResult =
  /** The tenant has no such instance (never had, or it was purged already). */
  | { readonly status: 'missing' }
  | {
      readonly status: 'skipped'
      /**
       * Nothing was erased. `not_removed`: the instance is in use (a purge follows a removal,
       * D81). `has_venues`: a venue of ours links to it (removal and restore refuse that, so
       * only a race leaves one). `in_use`: all that is left is the instance row and the records
       * that till values of kept items cite (see `instanceErased`).
       */
      readonly skipped: 'not_removed' | 'has_venues' | 'in_use'
    }
  | {
      readonly status: 'purged'
      readonly counts: Counts
      /**
       * False when the instance row stayed: an item a menu still places keeps its till values,
       * and these cite the instance's records (a foreign key), so those records and the row
       * they hang on stay until no menu uses the item; a later run erases them.
       */
      readonly instanceErased: boolean
    }

/**
 * Erases a removed POS instance (D91 point 2, D83): its till layer (places, the till venues it
 * lists, its job runs), the items that came only from it and no section places, its sections that
 * sit in no menu any more, the rest of its links, its records and the instance row with its
 * credentials. Data a venue still uses stays: a placed item, and any section inside a menu, keeps
 * its values and loses only its link to the instance. Refused while a venue of ours links to the
 * instance. One transaction on the purge role; a till venue linked in between is not deleted, and
 * the instance row's foreign keys then roll the whole purge back. No files: the instance
 * published none.
 */
export async function purgeInstance(
  deps: { readonly purgePool: DbPool },
  input: { readonly tenantId: string; readonly integrationId: string },
): Promise<PurgeInstanceResult> {
  const { tenantId, integrationId } = input
  return withTenantPurge(deps.purgePool, tenantId, async (tx) => {
    const [instance] = await tx
      .select({ removedAt: integrations.removedAt })
      .from(integrations)
      .where(eq(integrations.id, integrationId))
    if (instance === undefined) return { status: 'missing' } as const
    if (instance.removedAt === null) return { status: 'skipped', skipped: 'not_removed' } as const
    const [linked] = await tx
      .select({ venueId: tillVenueLinks.venueId })
      .from(tillVenueLinks)
      .where(
        and(eq(tillVenueLinks.integrationId, integrationId), isNotNull(tillVenueLinks.venueId)),
      )
      .limit(1)
    if (linked !== undefined) return { status: 'skipped', skipped: 'has_venues' } as const

    const counts: Counts = {}
    // The till layer: places first (they hang on their till venue), then the till venues.
    count(
      counts,
      'places',
      await tx
        .delete(places)
        .where(eq(places.integrationId, integrationId))
        .returning({ id: places.id }),
    )
    count(
      counts,
      'till_venue_links',
      await tx
        .delete(tillVenueLinks)
        .where(and(eq(tillVenueLinks.integrationId, integrationId), isNull(tillVenueLinks.venueId)))
        .returning({ bid: tillVenueLinks.bid }),
    )
    count(
      counts,
      'job_runs',
      await tx
        .delete(jobRuns)
        .where(eq(jobRuns.integrationId, integrationId))
        .returning({ id: jobRuns.id }),
    )
    // Sections in no menu first, with their placements (no menu shows them), so an item only they
    // placed counts as unplaced next.
    const detached = await instanceTrees(tx, integrationId, DETACHED_SECTIONS)
    if (detached.length > 0) {
      count(
        counts,
        'placements',
        await tx
          .delete(placements)
          .where(inArray(placements.sectionId, detached))
          .returning({ id: placements.itemId }),
      )
    }
    await deleteNodes(tx, detached, counts)
    await deleteNodes(tx, await instanceTrees(tx, integrationId, UNPLACED_ITEMS), counts)
    count(
      counts,
      'source_links',
      await tx
        .delete(sourceLinks)
        .where(eq(sourceLinks.integrationId, integrationId))
        .returning({ id: sourceLinks.nodeId }),
    )
    // A record that a kept node's till value cites stays (and so does the row it hangs on).
    count(
      counts,
      'source_records',
      await tx
        .delete(sourceRecords)
        .where(
          and(
            eq(sourceRecords.integrationId, integrationId),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(fieldValues)
                .where(eq(fieldValues.sourceRecordId, sourceRecords.id)),
            ),
          ),
        )
        .returning({ id: sourceRecords.id }),
    )
    const [cited] = await tx
      .select({ id: sourceRecords.id })
      .from(sourceRecords)
      .where(eq(sourceRecords.integrationId, integrationId))
      .limit(1)
    const instanceErased = cited === undefined
    if (instanceErased) {
      count(
        counts,
        'integrations',
        await tx
          .delete(integrations)
          .where(eq(integrations.id, integrationId))
          .returning({ id: integrations.id }),
      )
    }
    if (Object.values(counts).every((rows) => rows === 0)) {
      return { status: 'skipped', skipped: 'in_use' } as const
    }
    await logPurge(tx, tenantId, 'instance', integrationId, counts)
    return { status: 'purged', counts, instanceErased } as const
  })
}

/** Applies the versions rule (D96) to one menu + venue: the rows go, then their files. */
export async function purgeVersions(
  deps: { readonly purgePool: DbPool; readonly store: PublishStore },
  input: {
    readonly tenantId: string
    readonly venueId: string
    readonly menuId: string
    readonly now: Date
  },
): Promise<{ purged: number }> {
  const { tenantId, venueId, menuId, now } = input
  const gone = await withTenantPurge(deps.purgePool, tenantId, async (tx) => {
    const [pointer] = await tx
      .select({ current: publishPointers.currentSnapshotId })
      .from(publishPointers)
      .where(and(eq(publishPointers.menuId, menuId), eq(publishPointers.venueId, venueId)))
    const rows = await tx
      .select({
        id: snapshots.id,
        version: snapshots.version,
        status: snapshots.status,
        reason: snapshots.reason,
        hasBody: sql<boolean>`${snapshots.body} is not null`,
        restoresSnapshotId: snapshots.restoresSnapshotId,
        createdAt: snapshots.createdAt,
      })
      .from(snapshots)
      .where(and(eq(snapshots.menuId, menuId), eq(snapshots.venueId, venueId)))
    const decision = versionsToPurge({
      now,
      currentSnapshotId: pointer?.current ?? null,
      rows: rows as unknown as VersionRow[],
    })
    if (decision.purge.length === 0) return []
    const counts: Counts = {}
    await deleteSnapshots(tx, decision.purge, counts)
    await logPurge(tx, tenantId, 'versions', menuId, counts)
    return decision.purge
  })
  for (const id of gone) await deps.store.delete(snapshotPath(id as SnapshotId))
  return { purged: gone.length }
}

/** Erases the deleted areas and tables of a venue that waited 30 days (D95), tombstoning their codes. */
export async function purgeTables(
  deps: { readonly purgePool: DbPool; readonly store: PublishStore },
  input: { readonly tenantId: string; readonly venueId: string; readonly now: Date },
): Promise<{ tables: number; areas: number }> {
  const { tenantId, venueId, now } = input
  const due = cutoff(now, TABLE_BIN_DAYS)
  const gone = await withTenantPurge(deps.purgePool, tenantId, async (tx) => {
    const tableRows = await tx
      .select({
        id: venueTables.id,
        qrToken: venueTables.qrToken,
        qrCodeHash: venueTables.qrCodeHash,
      })
      .from(venueTables)
      .where(
        and(
          eq(venueTables.venueId, venueId),
          isNotNull(venueTables.archivedAt),
          lte(venueTables.archivedAt, due),
        ),
      )
    const areaRows = await tx
      .select({ id: areas.id })
      .from(areas)
      .where(
        and(eq(areas.venueId, venueId), isNotNull(areas.archivedAt), lte(areas.archivedAt, due)),
      )
    const tableIds = tableRows.map((row) => row.id)
    const areaIds = areaRows.map((row) => row.id)
    if (tableIds.length === 0 && areaIds.length === 0) return { tables: 0, areas: 0, files: [] }
    const counts: Counts = {}
    if (tableIds.length > 0) {
      count(
        counts,
        'menu_routes',
        await tx
          .delete(menuRoutes)
          .where(inArray(menuRoutes.tableId, tableIds))
          .returning({ id: menuRoutes.venueId }),
      )
      count(
        counts,
        'tables',
        await tx
          .delete(venueTables)
          .where(inArray(venueTables.id, tableIds))
          .returning({ id: venueTables.id }),
      )
    }
    if (areaIds.length > 0) {
      count(
        counts,
        'menu_routes',
        await tx
          .delete(menuRoutes)
          .where(inArray(menuRoutes.areaId, areaIds))
          .returning({ id: menuRoutes.venueId }),
      )
      count(
        counts,
        'areas',
        await tx.delete(areas).where(inArray(areas.id, areaIds)).returning({ id: areas.id }),
      )
    }
    const hashes = tableRows.flatMap((row) => (row.qrCodeHash === null ? [] : [row.qrCodeHash]))
    await tombstone(tx, tenantId, 'table_token', hashes)
    await logPurge(tx, tenantId, 'tables', venueId, counts)
    return {
      tables: tableIds.length,
      areas: areaIds.length,
      files: tableRows.flatMap(codeFileNames),
    }
  })
  for (const name of gone.files) await deps.store.delete(tableTokenPath(name))
  return { tables: gone.tables, areas: gone.areas }
}

/** Erases the change log past two months (D96) for one organisation. */
export async function purgeChangeLog(
  deps: { readonly purgePool: DbPool },
  input: { readonly tenantId: string; readonly now: Date },
): Promise<{ events: number }> {
  const before = cutoff(input.now, CHANGE_LOG_DAYS)
  return withTenantPurge(deps.purgePool, input.tenantId, async (tx) => {
    const rows = await tx.delete(events).where(lt(events.at, before)).returning({ id: events.seq })
    return { events: rows.length }
  })
}

/** What the tick found due in one organisation, from the app pool (reads only). */
async function dueIn(pool: DbPool, tenantId: string, now: Date) {
  return withTenant(pool, tenantId, async (tx) => {
    const binnedVenues = (
      await tx
        .select({ id: venues.id, archivedAt: venues.archivedAt })
        .from(venues)
        .where(isNotNull(venues.archivedAt))
    ).filter((row) => isDue(row.archivedAt, now, VENUE_BIN_DAYS))
    const binnedMenus = (
      await tx
        .select({ id: menus.id, venueId: menus.venueId, deletedAt: menus.deletedAt })
        .from(menus)
        .where(isNotNull(menus.deletedAt))
    ).filter((row) => isDue(row.deletedAt, now, MENU_BIN_DAYS))
    const removedInstances = (
      await tx
        .select({ id: integrations.id, removedAt: integrations.removedAt })
        .from(integrations)
        .where(isNotNull(integrations.removedAt))
    ).filter((row) => isDue(row.removedAt, now, INSTANCE_BIN_DAYS))
    const scopes = await tx
      .select({ menuId: publishPointers.menuId, venueId: publishPointers.venueId })
      .from(publishPointers)
    const venuesWithTables = await tx.selectDistinct({ id: venues.id }).from(venues)
    return {
      binnedVenues,
      binnedMenus,
      removedInstances,
      scopes,
      venueIds: venuesWithTables.map((row) => row.id),
    }
  })
}

function parsePayload<S extends z.ZodType>(schema: S, job: Job<object>, name: string): z.output<S> {
  const parsed = schema.safeParse(job.data)
  if (!parsed.success) throw new Error(`${name}: bad payload: ${parsed.error.message}`)
  return parsed.data
}

export function createPurgeJobs(deps: PurgeJobDeps): JobDefinition[] {
  const openPurgePool = () =>
    createPool(deps.purgeDatabaseUrl, { max: 1, applicationName: 'restro-worker-purge' })

  const purgeOne = defineJob<PurgeVenueJob>({
    name: JOB_NAMES.purgeVenue,
    options: {
      policy: 'stately',
      queue: {
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: 10 * 60,
        deleteAfterSeconds: 7 * 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 5 },
    },
    async handler(jobs, context) {
      const purgePool = openPurgePool()
      try {
        for (const job of jobs) {
          const payload = parsePayload(PurgeVenueJobSchema, job, JOB_NAMES.purgeVenue)
          await trackedRun(
            { pool: context.pool, log: context.log, now: context.now },
            { tenantId: payload.tenantId, venueId: payload.venueId, kind: 'purge_venue' },
            async (): Promise<RunReport> => {
              const result = await purgeVenue(
                { purgePool, pool: context.pool, store: deps.publishStore },
                payload,
              )
              if (result.status !== 'purged') {
                return {
                  notes: [`nothing erased: the venue is ${result.status.replace('_', ' ')}`],
                }
              }
              return {
                counters: { ...result.counts, files_removed: result.filesRemoved },
                notes: [
                  `the venue was erased; ${result.tokens.length} table codes and its public code are tombstoned`,
                ],
              }
            },
          )
        }
      } finally {
        await purgePool.end()
      }
    },
  })

  const tick = defineJob({
    name: JOB_NAMES.purgeTick,
    // Early morning, after the service day ended (07:00 is the latest default end; a purge is
    // not urgent and keeps away from the evening).
    schedule: { cron: '30 4 * * *', tz: 'Europe/Sofia' },
    options: {
      queue: {
        retryLimit: 1,
        retryDelay: 15 * 60,
        expireInSeconds: 60 * 60,
        retentionSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 30 },
    },
    async handler(_jobs, context: WorkerContext) {
      const now = context.now()
      const organizations = await withSystem(context.pool, (tx) =>
        tx.select({ id: authOrganization.id }).from(authOrganization),
      )
      const purgePool = openPurgePool()
      try {
        for (const { id: tenantId } of organizations) {
          await trackedRun(
            { pool: context.pool, log: context.log, now: context.now },
            { tenantId, kind: 'purge_tick' },
            async (): Promise<RunReport> => {
              const due = await dueIn(context.pool, tenantId, now)
              const counters: Record<string, number> = {
                venues: 0,
                menus: 0,
                instances: 0,
                versions: 0,
                tables: 0,
                areas: 0,
                events: 0,
              }
              const scoped = { purgePool, pool: context.pool, store: deps.publishStore }
              for (const venue of due.binnedVenues) {
                const result = await purgeVenue(scoped, { tenantId, venueId: venue.id })
                if (result.status === 'purged') counters.venues = (counters.venues ?? 0) + 1
              }
              for (const menu of due.binnedMenus) {
                const result = await purgeMenu(scoped, {
                  tenantId,
                  venueId: menu.venueId,
                  menuId: menu.id,
                })
                if (result.status === 'purged') counters.menus = (counters.menus ?? 0) + 1
              }
              // After the venues and menus: what they placed is free by now.
              for (const instance of due.removedInstances) {
                const result = await purgeInstance(scoped, {
                  tenantId,
                  integrationId: instance.id,
                })
                if (result.status === 'purged' && result.instanceErased) {
                  counters.instances = (counters.instances ?? 0) + 1
                }
              }
              for (const scope of due.scopes) {
                const result = await purgeVersions(scoped, { tenantId, ...scope, now })
                counters.versions = (counters.versions ?? 0) + result.purged
              }
              for (const venueId of due.venueIds) {
                const result = await purgeTables(scoped, { tenantId, venueId, now })
                counters.tables = (counters.tables ?? 0) + result.tables
                counters.areas = (counters.areas ?? 0) + result.areas
              }
              counters.events = (await purgeChangeLog(scoped, { tenantId, now })).events
              return { counters, notes: ['the daily purge ran'] }
            },
          )
        }
      } finally {
        await purgePool.end()
      }
    },
  })

  return [purgeOne, tick]
}
