// @restro/db/write: the writable, tenant-scoped transaction. Rule 1 (one write path): only
// packages/core/src/apply/ may import this entry; dependency-cruiser fails CI otherwise
// (rule `db-write-only-from-core-apply`). Row-level security still applies: a write can only
// touch the tenant the transaction is scoped to.
import { type DbPool, runForTenant, type Transaction } from '../internal/pool'

/** A tenant-scoped read-write transaction (every Drizzle query builder). */
export type WriteTx = Transaction

/**
 * Runs `fn` in a READ WRITE transaction scoped to one tenant; commits when `fn` resolves and
 * rolls back when it throws. Same checks as `withTenant`: malformed tenant ids are rejected
 * before touching the database, and a role that could bypass row-level security is refused.
 */
export function withTenantWrite<T>(
  pool: DbPool,
  tenantId: string,
  fn: (tx: WriteTx) => Promise<T>,
): Promise<T> {
  return runForTenant(pool, tenantId, 'read write', fn)
}
