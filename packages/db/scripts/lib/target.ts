// Shared by the owner-only scripts (db:migrate, db:roles): reading settings from the
// environment and refusing to touch a remote database by accident.
//
// CLAUDE.md: never run migrations against staging or production from a local machine. The
// scripts therefore accept only a local Postgres (localhost, 127.0.0.1, ::1 or a unix socket)
// unless RESTRO_DB_ALLOW_REMOTE=1 is set, which only the deploy pipeline and the runner named in
// docs/runbooks/supabase-setup.md may do. They never read .env files themselves.

/** Hosts that count as "this machine". */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Opt-in for a non-local database. */
export const ALLOW_REMOTE_ENV = 'RESTRO_DB_ALLOW_REMOTE'

/** Returns the environment variable or throws a message that says how to set it. */
export function requireEnv(name: string, hint: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. ${hint}`)
  return value
}

/** Host, port, database and user of a connection string, never its password. */
export function describeTarget(url: string): string {
  const parsed = parseUrl(url)
  const host = hostOf(parsed) || '(default host)'
  const port = parsed.port || '5432'
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || '(default database)'
  const user = decodeURIComponent(parsed.username) || '(default user)'
  return `${user}@${host}:${port}/${database}`
}

/** True when the connection string points at this machine. */
export function isLocalTarget(url: string): boolean {
  const host = hostOf(parseUrl(url))
  return LOCAL_HOSTS.has(host) || host.startsWith('/')
}

/** Throws unless the database is local or the remote opt-in is set. */
export function assertSafeTarget(url: string, command: string): void {
  if (isLocalTarget(url)) return
  const target = describeTarget(url)
  if (process.env[ALLOW_REMOTE_ENV] === '1') {
    console.warn(`${command}: ${ALLOW_REMOTE_ENV}=1, running against remote ${target}`)
    return
  }
  throw new Error(
    `${command} refuses to run against ${target}: it is not a local database. Migrations and ` +
      'roles reach staging and production only through the deploy pipeline or the runner in ' +
      `docs/runbooks/supabase-setup.md, which sets ${ALLOW_REMOTE_ENV}=1.`,
  )
}

function parseUrl(url: string): URL {
  try {
    return new URL(url)
  } catch {
    throw new Error('The database URL is not a valid postgres:// URL.')
  }
}

/** The host, including a `?host=` override (libpq style, also used for unix sockets). */
function hostOf(parsed: URL): string {
  return parsed.searchParams.get('host') ?? parsed.hostname
}
