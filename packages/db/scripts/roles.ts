// `pnpm db:roles`: creates or updates the login role `restro_app` that the web app and the
// worker connect as, and makes its privileges exactly what src/table-access.ts lists. Run it
// after every `pnpm db:migrate`; it is idempotent. Connects as the migration owner
// (DATABASE_URL_OWNER); the password comes from DATABASE_APP_PASSWORD and is sent to Postgres
// only as a SCRAM verifier. Owner-only code: never imported by the package's entry points.
//
// What it guarantees (and checks before committing, all in one transaction):
// - restro_app can log in and is not superuser, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION,
//   inherits nothing and is a member of no other role;
// - it owns no table in `restro` and cannot CREATE there; it may CONNECT to the database, use
//   `restro`, and use and create in `pgboss` (pg-boss's own tables);
// - on every table in `restro` it holds exactly the privileges in TABLE_ACCESS (never TRUNCATE,
//   REFERENCES or TRIGGER), and no role other than the owner and restro_app holds any;
// - every session of the role starts with `statement_timeout = 30s` and
//   `idle_in_transaction_session_timeout = 60s` (ALTER ROLE ... SET). They are set on the role
//   rather than in the connection string because Supabase's session pooler ignores startup
//   parameters (T46), while Postgres applies a role's own settings itself when a session starts;
// - it fails if a table exists in `restro` that TABLE_ACCESS does not list, so a new table
//   cannot ship without someone deciding what the app may do with it.
import pg from 'pg'

import {
  APP_ROLE,
  APP_SCHEMA,
  APP_SCHEMA_PRIVILEGES,
  TABLE_ACCESS,
  type TableAccess,
} from '../src/table-access.ts'
import { assertUsablePassword, scramSha256Verifier } from './lib/scram.ts'
import { assertSafeTarget, describeTarget, requireEnv } from './lib/target.ts'

const ALL_TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const
const ALL_SCHEMA_PRIVILEGES = ['USAGE', 'CREATE'] as const
const RELATION_KINDS = ['r', 'p', 'v', 'm', 'f']
const LOCK_NAME = 'restro:db:roles'

/**
 * Session defaults of the app role, set with ALTER ROLE ... SET (T46). A statement running
 * longer than the first is cancelled; a session idle inside an open transaction for longer than
 * the second is ended. Values are stored, and compared, exactly as written here.
 */
const ROLE_SETTINGS = {
  statement_timeout: '30s',
  idle_in_transaction_session_timeout: '60s',
} as const

const tableAccess: Record<string, TableAccess> = TABLE_ACCESS
const schemaPrivileges: Record<string, readonly string[]> = APP_SCHEMA_PRIVILEGES

interface RoleRow {
  rolsuper: boolean
  rolcreaterole: boolean
  rolcreatedb: boolean
  rolreplication: boolean
  rolbypassrls: boolean
  rolinherit: boolean
  rolcanlogin: boolean
}

type Client = pg.Client

function id(client: Client, name: string): string {
  return client.escapeIdentifier(name)
}

/**
 * Creates the role, or brings an existing one back to the required attributes. An existing
 * role keeps its password unless `rotatePassword` is set: every ALTER ROLE … PASSWORD stores a
 * new SCRAM salt, and Supabase's pooler (Supavisor) keeps the old verifier cached, so re-setting
 * even the same password breaks pooled logins until its cache refreshes (seen on restro-staging).
 */
async function upsertRole(
  client: Client,
  password: string,
  rotatePassword: boolean,
): Promise<'created' | 'updated'> {
  const role = id(client, APP_ROLE)
  const verifier = client.escapeLiteral(scramSha256Verifier(password))
  const { rows } = await client.query<RoleRow>(
    `select rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolinherit,
            rolcanlogin
     from pg_catalog.pg_roles where rolname = $1`,
    [APP_ROLE],
  )
  const current = rows[0]
  if (!current) {
    await client.query(
      `create role ${role} with login noinherit nocreatedb nocreaterole password ${verifier}`,
    )
    return 'created'
  }
  // Name only the attributes that must change: a non-superuser owner (Supabase's `postgres`)
  // may not even mention SUPERUSER, REPLICATION or BYPASSRLS in ALTER ROLE.
  const fixes: string[] = []
  if (current.rolsuper) fixes.push('nosuperuser')
  if (current.rolreplication) fixes.push('noreplication')
  if (current.rolbypassrls) fixes.push('nobypassrls')
  if (current.rolcreaterole) fixes.push('nocreaterole')
  if (current.rolcreatedb) fixes.push('nocreatedb')
  if (current.rolinherit) fixes.push('noinherit')
  if (!current.rolcanlogin) fixes.push('login')
  const changes = rotatePassword ? [...fixes, `password ${verifier}`] : fixes
  if (changes.length > 0) await client.query(`alter role ${role} with ${changes.join(' ')}`)
  return 'updated'
}

/** Sets the session defaults of the role (see ROLE_SETTINGS). Takes effect on new sessions. */
async function applyRoleSettings(client: Client): Promise<void> {
  for (const [name, value] of Object.entries(ROLE_SETTINGS)) {
    // `name` is one of the constants above and `value` a literal; neither comes from outside.
    await client.query(
      `alter role ${id(client, APP_ROLE)} set ${id(client, name)} = ${client.escapeLiteral(value)}`,
    )
  }
}

/** Grantees other than the object's owner and restro_app, from an ACL column. */
async function otherGrantees(
  client: Client,
  query: string,
  params: unknown[],
): Promise<{ object: string; grantee: string }[]> {
  const { rows } = await client.query<{ object: string; grantee: string }>(query, [
    ...params,
    APP_ROLE,
  ])
  return rows
}

const OTHER_SCHEMA_GRANTEES = `
  select n.nspname as object, coalesce(g.rolname, 'PUBLIC') as grantee
  from pg_catalog.pg_namespace n
  cross join lateral pg_catalog.aclexplode(n.nspacl) a
  left join pg_catalog.pg_roles g on g.oid = a.grantee
  where n.nspname = any($1::text[]) and a.grantee <> n.nspowner
    and g.rolname is distinct from $2
  group by 1, 2`

const OTHER_TABLE_GRANTEES = `
  select c.relname as object, coalesce(g.rolname, 'PUBLIC') as grantee
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(c.relacl) a
  left join pg_catalog.pg_roles g on g.oid = a.grantee
  where c.relnamespace = $1::regnamespace and c.relkind = any($2::"char"[])
    and a.grantee <> c.relowner and g.rolname is distinct from $3
  group by 1, 2`

function granteeSql(client: Client, grantee: string): string {
  return grantee === 'PUBLIC' ? 'public' : id(client, grantee)
}

async function grantSchemas(client: Client): Promise<void> {
  const names = Object.keys(schemaPrivileges)
  const { rows } = await client.query<{ nspname: string }>(
    'select nspname from pg_catalog.pg_namespace where nspname = any($1::text[])',
    [names],
  )
  const missing = names.filter((name) => !rows.some((row) => row.nspname === name))
  if (missing.length > 0) {
    throw new Error(`Schema(s) ${missing.join(', ')} missing: run pnpm db:migrate first.`)
  }
  for (const [schema, privileges] of Object.entries(schemaPrivileges)) {
    await client.query(`revoke all on schema ${id(client, schema)} from ${id(client, APP_ROLE)}`)
    await client.query(
      `grant ${privileges.join(', ')} on schema ${id(client, schema)} to ${id(client, APP_ROLE)}`,
    )
  }
  for (const { object, grantee } of await otherGrantees(client, OTHER_SCHEMA_GRANTEES, [names])) {
    await client.query(
      `revoke all on schema ${id(client, object)} from ${granteeSql(client, grantee)}`,
    )
  }
}

async function grantTables(client: Client): Promise<void> {
  const { rows } = await client.query<{ relname: string }>(
    `select relname from pg_catalog.pg_class
     where relnamespace = $1::regnamespace and relkind = any($2::"char"[]) order by relname`,
    [APP_SCHEMA, RELATION_KINDS],
  )
  const inDatabase = rows.map((row) => row.relname)
  const unlisted = inDatabase.filter((name) => !(name in tableAccess))
  if (unlisted.length > 0) {
    throw new Error(
      `Table(s) ${unlisted.map((name) => `${APP_SCHEMA}.${name}`).join(', ')} are not listed in ` +
        'packages/db/src/table-access.ts. Decide what the app role may do with them there.',
    )
  }
  const missing = Object.keys(tableAccess).filter((name) => !inDatabase.includes(name))
  if (missing.length > 0) {
    throw new Error(`Table(s) ${missing.join(', ')} do not exist yet: run pnpm db:migrate first.`)
  }
  for (const [name, access] of Object.entries(tableAccess)) {
    const table = `${id(client, APP_SCHEMA)}.${id(client, name)}`
    await client.query(`revoke all on table ${table} from ${id(client, APP_ROLE)}`)
    if (access.app.length > 0) {
      await client.query(
        `grant ${access.app.join(', ')} on table ${table} to ${id(client, APP_ROLE)}`,
      )
    }
  }
  const others = await otherGrantees(client, OTHER_TABLE_GRANTEES, [APP_SCHEMA, RELATION_KINDS])
  for (const { object, grantee } of others) {
    await client.query(
      `revoke all on table ${id(client, APP_SCHEMA)}.${id(client, object)} from ${granteeSql(client, grantee)}`,
    )
  }
  // No sequences exist (ids are text); routines are for the owner only. EXECUTE is granted to
  // PUBLIC by default, so take it back from everyone (trigger functions need no EXECUTE).
  const schema = id(client, APP_SCHEMA)
  await client.query(`revoke all on all sequences in schema ${schema} from ${id(client, APP_ROLE)}`)
  await client.query(`revoke all on all routines in schema ${schema} from public`)
  await client.query(`revoke all on all routines in schema ${schema} from ${id(client, APP_ROLE)}`)
}

/** Re-reads the catalog and throws if anything differs from what this script promises. */
async function verify(client: Client): Promise<void> {
  const problems: string[] = []

  const role = await client.query<RoleRow>(
    `select rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolinherit,
            rolcanlogin
     from pg_catalog.pg_roles where rolname = $1`,
    [APP_ROLE],
  )
  const attributes = role.rows[0]
  if (!attributes) {
    problems.push(`role ${APP_ROLE} does not exist`)
  } else {
    for (const [name, value] of Object.entries(attributes)) {
      const wanted = name === 'rolcanlogin'
      if (value !== wanted) problems.push(`${APP_ROLE}.${name} is ${value}, expected ${wanted}`)
    }
  }

  // Session defaults. A setting scoped to one database (ALTER ROLE ... IN DATABASE) would win
  // over the role-wide one, so it counts as a problem too.
  const settings = await client.query<{ database: string | null; setconfig: string[] }>(
    `select d.datname as database, s.setconfig
     from pg_catalog.pg_db_role_setting s
     join pg_catalog.pg_roles r on r.oid = s.setrole
     left join pg_catalog.pg_database d on d.oid = s.setdatabase
     where r.rolname = $1`,
    [APP_ROLE],
  )
  const roleWide = new Map<string, string>()
  for (const { database, setconfig } of settings.rows) {
    for (const entry of setconfig) {
      const at = entry.indexOf('=')
      const name = entry.slice(0, at)
      if (!Object.hasOwn(ROLE_SETTINGS, name)) continue
      if (database === null) roleWide.set(name, entry.slice(at + 1))
      else problems.push(`${APP_ROLE} has ${name} set for database ${database}; reset it by hand`)
    }
  }
  for (const [name, wanted] of Object.entries(ROLE_SETTINGS)) {
    const actual = roleWide.get(name)
    if (actual !== wanted)
      problems.push(`${APP_ROLE} ${name} is ${actual ?? 'not set'}, expected ${wanted}`)
  }

  const memberships = await client.query<{ rolname: string }>(
    `select r.rolname from pg_catalog.pg_auth_members m
     join pg_catalog.pg_roles r on r.oid = m.roleid
     join pg_catalog.pg_roles a on a.oid = m.member
     where a.rolname = $1`,
    [APP_ROLE],
  )
  for (const { rolname } of memberships.rows) {
    problems.push(`${APP_ROLE} is a member of ${rolname}; revoke it by hand (it could act as it)`)
  }

  const owned = await client.query<{ object: string }>(
    `select 'schema ' || nspname as object from pg_catalog.pg_namespace
     where nspname = $2 and pg_has_role($1, nspowner, 'MEMBER')
     union all
     select 'relation ' || relname from pg_catalog.pg_class
     where relnamespace = $2::regnamespace and pg_has_role($1, relowner, 'MEMBER')`,
    [APP_ROLE, APP_SCHEMA],
  )
  for (const { object } of owned.rows) problems.push(`${APP_ROLE} owns ${object} in ${APP_SCHEMA}`)

  const schemaGrants = await client.query<{ schema: string; privilege: string; granted: boolean }>(
    `select s.nsp as schema, p.privilege, has_schema_privilege($1, s.nsp, p.privilege) as granted
     from unnest($2::text[]) as s(nsp) cross join unnest($3::text[]) as p(privilege)`,
    [APP_ROLE, Object.keys(schemaPrivileges), ALL_SCHEMA_PRIVILEGES],
  )
  for (const { schema, privilege, granted } of schemaGrants.rows) {
    const wanted = schemaPrivileges[schema]?.includes(privilege) ?? false
    if (granted !== wanted) problems.push(`${privilege} on schema ${schema}: ${granted}`)
  }

  const tableGrants = await client.query<{ relname: string; privilege: string; granted: boolean }>(
    `select c.relname, p.privilege, has_table_privilege($1, c.oid, p.privilege) as granted
     from pg_catalog.pg_class c cross join unnest($4::text[]) as p(privilege)
     where c.relnamespace = $2::regnamespace and c.relkind = any($3::"char"[])`,
    [APP_ROLE, APP_SCHEMA, RELATION_KINDS, ALL_TABLE_PRIVILEGES],
  )
  for (const { relname, privilege, granted } of tableGrants.rows) {
    const wanted = (tableAccess[relname]?.app as readonly string[] | undefined) ?? []
    if (granted !== wanted.includes(privilege)) {
      problems.push(`${privilege} on ${APP_SCHEMA}.${relname}: ${granted}`)
    }
  }

  const strangers = [
    ...(await otherGrantees(client, OTHER_SCHEMA_GRANTEES, [[APP_SCHEMA]])),
    ...(await otherGrantees(client, OTHER_TABLE_GRANTEES, [APP_SCHEMA, RELATION_KINDS])),
  ]
  for (const { object, grantee } of strangers) {
    problems.push(`${grantee} still holds privileges on ${object} (granted by another role?)`)
  }

  if (problems.length > 0) {
    throw new Error(`Role check failed, nothing was changed:\n- ${problems.join('\n- ')}`)
  }
}

async function main(): Promise<void> {
  const url = requireEnv(
    'DATABASE_URL_OWNER',
    'It is the migration owner connection (local: postgres://postgres:postgres@localhost:54329/restro).',
  )
  const password = requireEnv(
    'DATABASE_APP_PASSWORD',
    `It is the password ${APP_ROLE} gets; DATABASE_URL must carry the same one.`,
  )
  assertUsablePassword(password)
  // Explicit opt-in: only then does an existing role get its password re-set (see upsertRole).
  const rotatePassword = process.env.DATABASE_APP_PASSWORD_ROTATE === '1'
  assertSafeTarget(url, 'db:roles')

  const client = new pg.Client({ connectionString: url, application_name: 'restro-db-roles' })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [LOCK_NAME])
    const session = await client.query<{ owner: string; database: string }>(
      'select current_user as owner, current_database() as database',
    )
    const { owner, database } = session.rows[0] ?? { owner: '', database: '' }
    if (owner === APP_ROLE) {
      throw new Error(`DATABASE_URL_OWNER logs in as ${APP_ROLE}; it must be the migration owner.`)
    }

    const outcome = await upsertRole(client, password, rotatePassword)
    await applyRoleSettings(client)
    await client.query(
      `revoke all on database ${id(client, database)} from ${id(client, APP_ROLE)}`,
    )
    await client.query(
      `grant connect on database ${id(client, database)} to ${id(client, APP_ROLE)}`,
    )
    await grantSchemas(client)
    await grantTables(client)
    await verify(client)
    await client.query('commit')
    console.log(
      `db:roles: ${APP_ROLE} ${outcome}` +
        `${outcome === 'updated' ? (rotatePassword ? ' (password rotated)' : ' (password kept)') : ''}` +
        ` on ${describeTarget(url)}; privileges match ` +
        `src/table-access.ts (${Object.keys(tableAccess).length} tables); ` +
        `${Object.entries(ROLE_SETTINGS)
          .map(([name, value]) => `${name} = ${value}`)
          .join(', ')}.`,
    )
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(`db:roles failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
