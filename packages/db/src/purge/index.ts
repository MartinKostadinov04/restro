// @restro/db/purge: the purge role's tenant-scoped transaction (D83). The worker's purge job is
// the only code that may import this entry (dependency-cruiser rule
// `db-purge-only-from-worker-purge-job`): it erases a purged venue's data, a binned menu, a
// removed POS instance's data and old versions, and writes the tombstones and the purge log,
// through a pool that logs in as `restro_purge` (DATABASE_URL_PURGE). Row-level security still
// applies: a purge can only touch the tenant the transaction is scoped to, and the role holds
// exactly the privileges src/table-access.ts lists under `purge`.
//
// Nothing here goes through `apply()` or writes `events`: a purge is not a change of the menu,
// it is the end of the record (D83); what it did is in `purge_log`, without content.
import { sql } from 'drizzle-orm'

import { type DbPool, runForTenant, type Transaction } from '../internal/pool'
import { PURGE_ROLE } from '../table-access'

/** A tenant-scoped read-write transaction on the purge role (every Drizzle query builder). */
export type PurgeTx = Transaction

/** Thrown before any purge when the pool's login role is not `restro_purge`. */
export class NotThePurgeRoleError extends Error {
  constructor(role: string) {
    super(
      `Refusing to purge as database role "${role}": the purge job must connect as ` +
        `${PURGE_ROLE} (DATABASE_URL_PURGE), the only role allowed to erase venue data (D83).`,
    )
    this.name = 'NotThePurgeRoleError'
  }
}

/**
 * Runs `fn` in a READ WRITE transaction scoped to one tenant on the purge role; commits when `fn`
 * resolves and rolls back when it throws. Same checks as `withTenant` (a malformed tenant id is
 * rejected before touching the database; a role that could bypass row-level security is
 * refused), plus one of its own: the connected role must be `restro_purge`, so the app's pool
 * can never be handed in by mistake.
 */
export function withTenantPurge<T>(
  pool: DbPool,
  tenantId: string,
  fn: (tx: PurgeTx) => Promise<T>,
): Promise<T> {
  return runForTenant(pool, tenantId, 'read write', async (tx) => {
    const result = await tx.execute<{ role: string }>(sql`select current_user as role`)
    const role = result.rows[0]?.role ?? 'unknown'
    if (role !== PURGE_ROLE) throw new NotThePurgeRoleError(role)
    return fn(tx)
  })
}
