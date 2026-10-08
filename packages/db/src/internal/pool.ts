// Connection pool and scoped transactions, shared by the read entry (`@restro/db`) and the write
// entry (`@restro/db/write`). Not exported from the package: the exports map exposes only those
// two entry points, so app code can reach the database only through a scoped transaction.
import { sql } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from '../schema'

/** The Drizzle database type, with our schema. */
type Database = NodePgDatabase<typeof schema>

/** A Drizzle transaction on our schema, with every query builder. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Tenant ids are `tn_` + base62 (see `newId` in @restro/core). */
const TENANT_ID_PATTERN = /^tn_[0-9A-Za-z]+$/

/** True when `value` has the shape of a tenant id. */
export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value)
}

/** Thrown before any query when a tenant id is malformed (empty, wrong prefix, odd characters). */
export class InvalidTenantIdError extends TypeError {
  constructor() {
    super('Tenant id must look like tn_<base62>.')
    this.name = 'InvalidTenantIdError'
  }
}

/**
 * Thrown when the pool's login role could escape row-level security: a superuser, a role with
 * BYPASSRLS, or the owner of the restro tables. Apps must connect as `restro_app`.
 */
export class UnsafeDatabaseRoleError extends Error {
  constructor(role: string) {
    super(
      `Refusing to run: database role "${role}" can bypass row-level security (superuser, ` +
        'BYPASSRLS or owner of the restro tables). Connect the app as restro_app ' +
        '(DATABASE_URL); the owner role is for migrations only.',
    )
    this.name = 'UnsafeDatabaseRoleError'
  }
}

/** Options for {@link createPool}. */
export interface PoolOptions {
  /** Most connections the pool opens. Keep the sum of all pools under the pooler's limit. */
  readonly max?: number
  /** Shown in pg_stat_activity, e.g. 'restro-web' or 'restro-worker'. */
  readonly applicationName?: string
  /** Called when an idle connection fails. Without a handler such errors would crash Node. */
  readonly onIdleError?: (error: Error) => void
}

interface PoolInternals {
  readonly pool: pg.Pool
  readonly db: Database
}

const internals = new WeakMap<DbPool, PoolInternals>()

/**
 * An opaque handle on a connection pool. It runs no queries itself: pass it to `withTenant`,
 * `withSystem` or (core/apply only) `withTenantWrite`.
 */
export class DbPool {
  /** Closes every connection. Call once at shutdown. */
  async end(): Promise<void> {
    await internalsOf(this).pool.end()
  }
}

function internalsOf(handle: DbPool): PoolInternals {
  const found = internals.get(handle)
  if (!found) throw new TypeError('Not a pool created by createPool().')
  return found
}

/** Creates a pool for the app role. `url` is DATABASE_URL (restro_app), never the owner's. */
export function createPool(url: string, options: PoolOptions = {}): DbPool {
  if (!url) throw new TypeError('createPool needs a database URL (DATABASE_URL).')
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 5,
    application_name: options.applicationName ?? 'restro',
  })
  const onIdleError =
    options.onIdleError ??
    ((error: Error) => console.error(`[@restro/db] idle connection error: ${error.message}`))
  pool.on('error', onIdleError)
  const handle = new DbPool()
  internals.set(handle, { pool, db: drizzle({ client: pool, schema }) })
  return handle
}

/** Whether a scoped transaction may write. */
export type AccessMode = 'read only' | 'read write'

/**
 * Runs `fn` in one transaction whose first statement sets the transaction-local tenant
 * (`''` = no tenant) and checks, in the same round trip, that the connected role is held to
 * row-level security. Commits when `fn` resolves, rolls back when it throws.
 */
export async function runScoped<T>(
  handle: DbPool,
  tenantId: string,
  accessMode: AccessMode,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const { db } = internalsOf(handle)
  return db.transaction(
    async (tx) => {
      const result = await tx.execute<{ role: string; unsafe: boolean }>(sql`
        select set_config('app.tenant_id', ${tenantId}, true) is not null as scoped,
               current_user as role,
               r.rolsuper or r.rolbypassrls or pg_has_role(current_user, c.relowner, 'MEMBER')
                 as unsafe
        from pg_catalog.pg_roles r, pg_catalog.pg_class c
        where r.rolname = current_user and c.oid = 'restro.tenants'::regclass
      `)
      // Only an explicit `false` is safe; a missing row or NULL counts as unsafe.
      const row = result.rows[0]
      if (row?.unsafe !== false) throw new UnsafeDatabaseRoleError(row?.role ?? 'unknown')
      return fn(tx)
    },
    { accessMode },
  )
}

/** Validates a tenant id, then runs `fn` scoped to that tenant. */
export function runForTenant<T>(
  handle: DbPool,
  tenantId: string,
  accessMode: AccessMode,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!isTenantId(tenantId)) return Promise.reject(new InvalidTenantIdError())
  return runScoped(handle, tenantId, accessMode, fn)
}
