// @restro/db, the read side: the connection pool, tenant-scoped READ ONLY transactions, the
// system-table scope, and the Drizzle schema objects. Writes to tenant data go through
// `@restro/db/write`, which only core/apply may import, and purges through `@restro/db/purge`,
// which only the worker's purge job may import (dependency-cruiser enforces both).
// This file must never import from ./write or ./purge.
import { sql } from 'drizzle-orm'

import { type DbPool, runForTenant, runScoped, type Transaction } from './internal/pool'
import type {
  areas,
  assets,
  barsyVenues,
  events,
  fieldValues,
  integrations,
  itemFirstPublished,
  jobRuns,
  menuRoutes,
  menus,
  nodes,
  organizationSlugHistory,
  placements,
  places,
  publishPointers,
  purgeLog,
  snapshots,
  sourceLinks,
  sourceRecords,
  tags,
  templates,
  tenants,
  tombstones,
  venueSlugHistory,
  venues,
  venueTables,
  workerHeartbeats,
} from './schema'

export {
  createPool,
  type DbPool,
  InvalidTenantIdError,
  isTenantId,
  type PoolOptions,
  type SessionLock,
  tryAdvisoryLock,
  UnsafeDatabaseRoleError,
} from './internal/pool'
export * from './schema'
export type { RestroTableName } from './table-access'

/** A tenant-scoped read transaction: the query builders that cannot write. */
export type ReadTx = Omit<Transaction, 'insert' | 'update' | 'delete'>

/** A transaction with no tenant set: tenant tables are invisible, system tables are writable. */
export type SystemTx = Transaction

/**
 * Runs `fn` in a READ ONLY transaction scoped to one tenant: row-level security shows only that
 * tenant's rows, even when a query forgets its `where tenant_id = ...`. Any write is rejected by
 * Postgres. Rejects a malformed tenant id before touching the database, and refuses to run if
 * the pool's role could bypass row-level security.
 */
export function withTenant<T>(
  pool: DbPool,
  tenantId: string,
  fn: (tx: ReadTx) => Promise<T>,
): Promise<T> {
  return runForTenant(pool, tenantId, 'read only', fn)
}

/**
 * Runs `fn` in a transaction with no tenant: every tenant table returns zero rows and rejects
 * writes; only system tables (worker_heartbeats) can be read and written. For worker
 * housekeeping, never for tenant data.
 */
export function withSystem<T>(pool: DbPool, fn: (tx: SystemTx) => Promise<T>): Promise<T> {
  return runScoped(pool, '', 'read write', fn)
}

/** Where a guest's table code leads (D121): `restro.guest_table_by_code_hash`'s one row. */
export interface GuestTableByCode {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
  readonly codeGeneration: number
  /** `hidden`: the table or its area is hidden; `venue_not_live`: deleted or taken offline. */
  readonly state: 'live' | 'hidden' | 'venue_not_live'
}

const CODE_HASH_PATTERN = /^[0-9a-f]{64}$/

/**
 * Finds the table a guest's code belongs to, before any tenant is known (D121): the one query
 * that crosses tenants, through the pinned SECURITY DEFINER function (migration 0029). Takes the
 * code's SHA-256 hex, never the code. Null for an unknown or malformed hash, a deleted table or
 * a payment table.
 */
export async function guestTableByCodeHash(
  pool: DbPool,
  codeHash: string,
): Promise<GuestTableByCode | null> {
  if (!CODE_HASH_PATTERN.test(codeHash)) return null
  return runScoped(pool, '', 'read only', async (tx) => {
    const result = await tx.execute<{
      tenant_id: string
      venue_id: string
      table_id: string
      code_generation: number
      state: GuestTableByCode['state']
    }>(sql`select tenant_id, venue_id, table_id, code_generation, state
           from restro.guest_table_by_code_hash(${codeHash})`)
    const row = result.rows[0]
    if (!row) return null
    return {
      tenantId: row.tenant_id,
      venueId: row.venue_id,
      tableId: row.table_id,
      codeGeneration: row.code_generation,
      state: row.state,
    }
  })
}

/** A row of restro.tenants. */
export type Tenant = typeof tenants.$inferSelect
/** A row of restro.venues. */
export type Venue = typeof venues.$inferSelect
/** A row of restro.templates. */
export type Template = typeof templates.$inferSelect
/** A row of restro.worker_heartbeats. */
export type WorkerHeartbeat = typeof workerHeartbeats.$inferSelect
/** A row of restro.integrations. */
export type Integration = typeof integrations.$inferSelect
/** A row of restro.barsy_venues. */
export type BarsyVenue = typeof barsyVenues.$inferSelect
/** A row of restro.menus. */
export type Menu = typeof menus.$inferSelect
/** A row of restro.nodes. */
export type NodeRow = typeof nodes.$inferSelect
/** A row of restro.placements. */
export type Placement = typeof placements.$inferSelect
/** A row of restro.field_values. */
export type FieldValueRow = typeof fieldValues.$inferSelect
/** A row of restro.source_records. */
export type SourceRecord = typeof sourceRecords.$inferSelect
/** A row of restro.source_links. */
export type SourceLinkRow = typeof sourceLinks.$inferSelect
/** A row of restro.events. */
export type EventRow = typeof events.$inferSelect
/** A row of restro.job_runs. */
export type JobRun = typeof jobRuns.$inferSelect
/** A row of restro.places. */
export type Place = typeof places.$inferSelect
/** A row of restro.assets. */
export type Asset = typeof assets.$inferSelect
/** A row of restro.snapshots. */
export type SnapshotRow = typeof snapshots.$inferSelect
/** A row of restro.publish_pointers. */
export type PublishPointer = typeof publishPointers.$inferSelect
/** A row of restro.item_first_published. */
export type ItemFirstPublishedRow = typeof itemFirstPublished.$inferSelect
/** A row of restro.tags. */
export type TagRow = typeof tags.$inferSelect
/** A row of restro.areas. */
export type AreaRow = typeof areas.$inferSelect
/** A row of restro.tables (a venue's table; the Drizzle object is `venueTables`). */
export type VenueTableRow = typeof venueTables.$inferSelect
/** A row of restro.menu_routes. */
export type MenuRouteRow = typeof menuRoutes.$inferSelect
/** A row of restro.venue_slug_history. */
export type VenueSlugHistoryRow = typeof venueSlugHistory.$inferSelect
/** A row of restro.organization_slug_history. */
export type OrganizationSlugHistoryRow = typeof organizationSlugHistory.$inferSelect
/** A row of restro.tombstones. */
export type TombstoneRow = typeof tombstones.$inferSelect
/** A row of restro.purge_log. */
export type PurgeLogRow = typeof purgeLog.$inferSelect
