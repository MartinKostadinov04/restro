// The web app's two connections to Postgres, both as the app role (DATABASE_URL, restro_app):
//
// - `getPool()`: the tenant-scoped client of @restro/db. Menu and venue data go through it
//   (`withTenant` for reads; writes only through @restro/core/apply).
// - `getAuthDb()`: Better Auth's own pool, with Drizzle over the `auth_*` tables. Those tables are
//   not tenant-scoped, so they cannot use `withTenant`.
//
// Neither is created before first use, and both survive Next.js hot reloads in development.
import {
  authAccount,
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authUser,
  authVerification,
  createPool,
  type DbPool,
  UnsafeDatabaseRoleError,
} from '@restro/db'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import { serverEnv } from './env'
import { logError } from './log'

/** Better Auth's model names mapped to the Drizzle tables (the adapter's `schema` option). */
export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  organization: authOrganization,
  member: authMember,
  invitation: authInvitation,
}

export type AuthDb = NodePgDatabase<typeof authSchema>

interface Connections {
  pool?: DbPool
  authDb?: AuthDb
  authPg?: pg.Pool
  roleCheck?: Promise<void>
}

const globals = globalThis as typeof globalThis & { __restroConnections?: Connections }
globals.__restroConnections ??= {}
const connections: Connections = globals.__restroConnections

/** The tenant-scoped database client. */
export function getPool(): DbPool {
  connections.pool ??= createPool(serverEnv().DATABASE_URL, {
    max: 5,
    applicationName: 'restro-web',
    onIdleError: (error) => logError('db_idle_connection_error', error),
  })
  return connections.pool
}

function authPool(): pg.Pool {
  if (!connections.authPg) {
    const pool = new pg.Pool({
      connectionString: serverEnv().DATABASE_URL,
      max: 3,
      application_name: 'restro-web-auth',
    })
    pool.on('error', (error) => logError('auth_db_idle_connection_error', error))
    connections.authPg = pool
  }
  return connections.authPg
}

/** Drizzle over Better Auth's own pool. */
export function getAuthDb(): AuthDb {
  connections.authDb ??= drizzle({ client: authPool(), schema: authSchema })
  return connections.authDb
}

/**
 * Throws if Better Auth's pool connects as a role that could bypass row-level security
 * (superuser, BYPASSRLS, or an owner of the restro tables): the same rule `@restro/db` applies to
 * its own pool. Runs once per process; a failure is remembered and thrown again.
 */
export function assertAuthRoleIsSafe(): Promise<void> {
  connections.roleCheck ??= (async () => {
    const result = await authPool().query<{ role: string; unsafe: boolean | null }>(
      `select current_user as role,
              r.rolsuper or r.rolbypassrls or pg_has_role(current_user, c.relowner, 'MEMBER')
                as unsafe
       from pg_catalog.pg_roles r, pg_catalog.pg_class c
       where r.rolname = current_user and c.oid = 'restro.tenants'::regclass`,
    )
    const row = result.rows[0]
    if (row?.unsafe !== false) throw new UnsafeDatabaseRoleError(row?.role ?? 'unknown')
  })()
  return connections.roleCheck
}
