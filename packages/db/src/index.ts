// @restro/db, the read side: the connection pool, tenant-scoped READ ONLY transactions, the
// system-table scope, and the Drizzle schema objects. Writes to tenant data go through
// `@restro/db/write`, which only core/apply may import (dependency-cruiser enforces it).
// This file must never import from ./write.
import { type DbPool, runForTenant, runScoped, type Transaction } from './internal/pool'
import type { templates, tenants, venues, workerHeartbeats } from './schema'

export {
  createPool,
  type DbPool,
  InvalidTenantIdError,
  isTenantId,
  type PoolOptions,
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

/** A row of restro.tenants. */
export type Tenant = typeof tenants.$inferSelect
/** A row of restro.venues. */
export type Venue = typeof venues.$inferSelect
/** A row of restro.templates. */
export type Template = typeof templates.$inferSelect
/** A row of restro.worker_heartbeats. */
export type WorkerHeartbeat = typeof workerHeartbeats.$inferSelect
