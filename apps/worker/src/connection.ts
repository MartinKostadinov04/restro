// How the worker connects to Postgres. Two pools share one DATABASE_URL (the app role
// `restro_app`): the @restro/db pool for our own tables, and pg-boss's pool for the queue. On
// Supabase's session pooler every client connection counts against a small per-project limit
// (docs/runbooks/supabase-setup.md, section 4), so the two together stay at five connections.

/** Connections in the @restro/db pool (heartbeat and, later, job work on our tables). */
export const APP_POOL_MAX = 2

/** Connections in pg-boss's own pool (polling, scheduling, maintenance). */
export const QUEUE_POOL_MAX = 3

/** The Postgres schema pg-boss keeps its tables in. The migration owner creates it. */
export const QUEUE_SCHEMA = 'pgboss'

/** A statement that runs longer than this is cancelled by Postgres. */
export const STATEMENT_TIMEOUT_MS = 30_000

/**
 * A session that sits in an open transaction without a statement for this long is ended by
 * Postgres. No job should hold a transaction open while it waits for something else.
 */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000

/**
 * `url` with `statement_timeout` and `idle_in_transaction_session_timeout` added as query
 * parameters, so that Postgres applies them to every connection of both pools from the first
 * statement (node-postgres sends them as startup parameters). A value already in the URL wins,
 * so an operator can override one; a URL with an `options` parameter is left alone. The rest of
 * the URL is not re-encoded.
 */
export function withSessionTimeouts(url: string): string {
  const { searchParams } = new URL(url)
  if (searchParams.has('options')) return url
  const missing: string[] = []
  if (!searchParams.has('statement_timeout')) {
    missing.push(`statement_timeout=${STATEMENT_TIMEOUT_MS}`)
  }
  if (!searchParams.has('idle_in_transaction_session_timeout')) {
    missing.push(`idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`)
  }
  if (missing.length === 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}${missing.join('&')}`
}
