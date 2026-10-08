// How the worker connects to Postgres. Two pools share one DATABASE_URL (the app role
// `restro_app`): the @restro/db pool for our own tables, and pg-boss's pool for the queue. On
// Supabase's session pooler every client connection counts against a small per-project limit
// (docs/runbooks/supabase-setup.md, section 4), so the two together stay at five connections.
//
// Session timeouts are not set here. `pnpm db:roles` gives the role `restro_app` a 30 s
// `statement_timeout` and a 60 s `idle_in_transaction_session_timeout` (ALTER ROLE ... SET), so
// every connection of both pools, and of the web app, starts with them. They are not repeated as
// startup parameters in the URL: Supabase's session pooler ignores those, and where a server
// honours them they would override the role's values, leaving two places that must agree.

/** Connections in the @restro/db pool (heartbeat and, later, job work on our tables). */
export const APP_POOL_MAX = 2

/** Connections in pg-boss's own pool (polling, scheduling, maintenance). */
export const QUEUE_POOL_MAX = 3

/** The Postgres schema pg-boss keeps its tables in. The migration owner creates it. */
export const QUEUE_SCHEMA = 'pgboss'
