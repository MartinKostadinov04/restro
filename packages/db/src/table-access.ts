// The security posture of every table in schema `restro`, in one reviewable list.
//
// - `tenancy` says how rows are isolated. `tenant` and `tenant-root` tables must have FORCE ROW
//   LEVEL SECURITY with policies on app.tenant_id (`SELECT restro.enable_tenant_rls(...)` in the
//   migration); `tenant-or-system` adds rows with a NULL tenant that every tenant may read;
//   `system` tables hold no tenant data at all and have no tenant_id column.
// - `app` lists the only table privileges the app role (`restro_app`) holds. `pnpm db:roles`
//   revokes everything else and fails if a table exists in the database but not here.
// - `purge` lists the only table privileges the purge role (`restro_purge`) holds (D83): the
//   worker's purge job connects as it to erase a purged venue's data, a binned menu, a removed
//   POS instance's data and old versions, and to write the tombstones and the purge log. It is
//   the only role with DELETE on venue data; absent = nothing. It is held to row-level security
//   like the app role (it scopes every transaction to one tenant).
//
// Adding a table (tests/rls-guard.test.ts and tests/app-role.test.ts fail until all agree):
//   1. Define it in src/schema.ts with `restro.table(...)`; a tenant table gets a NOT NULL
//      `tenant_id` referencing tenants.id.
//   2. `pnpm db:generate` writes the CREATE TABLE migration.
//   3. `pnpm db:generate --custom --name=<table>_rls` and put one line in it:
//        SELECT restro.enable_tenant_rls('restro.<table>');
//      (or hand-written policies like templates', all testing app.tenant_id).
//   4. Add the table here with its tenancy and the fewest app privileges that work.
//   5. `pnpm db:migrate && pnpm db:roles`, then `pnpm test`.
// Never use `drizzle-kit push`: it would drop the hand-written policies. Policies call no
// functions today; `pnpm db:roles` revokes EXECUTE on every routine in `restro`, so a policy
// that needs one must also get an explicit grant in scripts/roles.ts.
//
// This file must stay free of runtime imports: scripts/roles.ts loads it directly with Node.

/** The login role the web app and the worker connect as. Never owner, never BYPASSRLS. */
export const APP_ROLE = 'restro_app'

/**
 * The login role the worker's purge job connects as (D83): the only role with DELETE on venue
 * data. Never owner, never BYPASSRLS; nothing but the purge job may use it.
 */
export const PURGE_ROLE = 'restro_purge'

/** The schema that holds every Restro table. */
export const APP_SCHEMA = 'restro'

/** The schema pg-boss keeps its queue tables in. Created by the migration owner. */
export const JOB_QUEUE_SCHEMA = 'pgboss'

/** Table privileges that `pnpm db:roles` may grant. TRUNCATE (which ignores RLS) is not one. */
export type TablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

/** How a table's rows are kept apart between tenants. */
export type Tenancy = 'tenant-root' | 'tenant' | 'tenant-or-system' | 'system'

/** One table's isolation and the two roles' privileges on it. */
export interface TableAccess {
  readonly tenancy: Tenancy
  readonly app: readonly TablePrivilege[]
  /** The purge role's privileges; left out = none. */
  readonly purge?: readonly TablePrivilege[]
}

/** What the purge role holds on a table whose rows a purge erases: read to find them, delete. */
const PURGED = ['SELECT', 'DELETE'] as const

/** Every table in schema `restro`, keyed by its Postgres name. */
export const TABLE_ACCESS = {
  // Rows are visible only while they are the current tenant (RLS on `id`). Tenants are created
  // inside their own tenant scope; deleting one is an operator task, not an app action.
  tenants: { tenancy: 'tenant-root', app: ['SELECT', 'INSERT', 'UPDATE'], purge: ['SELECT'] },
  // Archived by the app (`archived_at`); the row itself goes only with the purge.
  venues: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // Immutable rows: no UPDATE, no DELETE.
  templates: { tenancy: 'tenant-or-system', app: ['SELECT', 'INSERT'] },
  // Upserted by the worker through withSystem().
  worker_heartbeats: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'] },

  // The menu document and its sources (brief S2-01). Every one is tenant-scoped with FORCE RLS
  // (migration 0004). The app role may DELETE only `placements`, `field_values` and
  // `source_links`, through `apply()`, as the action itself (unplace, clear a field, unlink).
  // Erasing venue data, or anything in bulk, is only the purge job's, through its dedicated
  // role (D83, made precise by Martin 10-12).
  // Status and last check change; credentials are replaced; never deleted by the app (disable
  // instead); a removed instance's data goes with the purge.
  integrations: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // Renamed, mapped to one of our venues.
  barsy_venues: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // Several per venue (migration 0019): named, ordered, binned (`deleted_at`) and set live by
  // the app; a binned menu is erased by the purge.
  menus: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // Status and revision change; nodes are archived, never deleted by the app.
  nodes: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  placements: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], purge: PURGED },
  field_values: {
    tenancy: 'tenant',
    app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    purge: PURGED,
  },
  // Tier 1 is append-only: a changed object is a new row.
  source_records: { tenancy: 'tenant', app: ['SELECT', 'INSERT'], purge: PURGED },
  // The link lifecycle (active / missing / deleted, last seen) updates rows; unlink deletes one.
  source_links: {
    tenancy: 'tenant',
    app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    purge: PURGED,
  },
  // Append-only changelog (rule 2); only a purge removes a purged venue's rows.
  events: { tenancy: 'tenant', app: ['SELECT', 'INSERT'], purge: PURGED },
  job_runs: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // The first connector's till layer under `tables` (migration 0020).
  places: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  assets: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },

  // Areas and tables (migration 0020; D95). Renamed, reordered, hidden and archived by the app;
  // erased by the purge. Menu routes are rows per area or table, cleared by an update.
  areas: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  tables: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  menu_routes: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },

  // Old address names (migration 0022; D84): added on a rename, never changed; a venue's go
  // with its purge; an organisation's stay (organisations are not purged).
  venue_slug_history: { tenancy: 'tenant', app: ['SELECT', 'INSERT'], purge: PURGED },
  organization_slug_history: { tenancy: 'system', app: ['SELECT', 'INSERT'] },

  // What was published (brief S3-01a; migration 0008). Snapshot bodies never change: UPDATE is
  // only for a held row's decision, and a trigger refuses any other change. Only the purge
  // removes old versions (D96) and a purged venue's rows.
  snapshots: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // One row per menu + venue, moved by every publish and rollback.
  publish_pointers: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // Written once per item, never changed.
  item_first_published: { tenancy: 'tenant', app: ['SELECT', 'INSERT'], purge: PURGED },

  // A venue's tag list (brief S3-06; migration 0010). Renamed, recoloured, reordered and archived
  // (`archived_at`), never deleted by the app: items and old snapshots still name a tag by its id.
  tags: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },

  // The purge's own records (migration 0023; D83): the app reads, only the purge writes. A
  // tombstone or a log line is never changed or removed.
  tombstones: { tenancy: 'system', app: ['SELECT'], purge: ['SELECT', 'INSERT'] },
  purge_log: { tenancy: 'tenant', app: ['SELECT'], purge: ['SELECT', 'INSERT'] },

  // A venue's bars (migration 0028; D124 §1): menu-side, written by `apply()`, archived by the
  // app, erased by the purge.
  bars: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },

  // Service data (migration 0028; D122 §9; ticket #66): written only by `applyService`. Rows are
  // reused, emptied or ended by an update, never deleted by the app; the purge erases them when
  // their retention ends (31 days, 18 months, or with the venue). The Log and the notes are
  // append-only.
  sittings: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  table_orders: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  sent_orders: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  sent_order_notes: { tenancy: 'tenant', app: ['SELECT', 'INSERT'], purge: PURGED },
  locks: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  bill_readings: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  log_entries: { tenancy: 'tenant', app: ['SELECT', 'INSERT'], purge: PURGED },
  waiter_calls: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  alerts: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  pauses: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  service_days: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  staff_members: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  venue_roles: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  staff_assignments: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  shared_devices: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  push_subscriptions: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // Restro's admin team (D122 §7): the app only reads it; granting is an operator task.
  operators: { tenancy: 'system', app: ['SELECT'] },

  // Service data for paying (migration 0030; D127 §Records; ticket #104): written only by
  // `applyService`, never deleted by the app; the purge erases a payment's rows when its 18 months
  // end, or with the venue. The steps are append-only (D127 3.9).
  payments: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  payment_lines: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  payment_steps: { tenancy: 'tenant', app: ['SELECT', 'INSERT'], purge: PURGED },
  payment_accounts: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },
  // The provider's notices: platform-level, no tenant (the worker maps the account to a venue).
  // The web app and the worker share the app role, so the route's insert-only reach is pinned
  // by dependency-cruiser (`notice-route-records-only`), not by a grant. The app never deletes
  // one; the purge role erases them 18 months after they were received (#166; D111, D127), the
  // one system table it may delete from.
  provider_notices: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'], purge: PURGED },

  // Better Auth (apps/web talks to these through its own pool on the app role). They are not
  // tenant-scoped: a person signs in before any tenant is known, and the organisation id is the
  // tenant id (see schema.ts). The app role can read every row of them, password hashes
  // included; that is what "not tenant-scoped" means, so keep Better Auth's endpoints narrow.
  // DELETE is granted only where a flow we keep needs it: `auth_session` (sign-out, revoking a
  // session, clearing expired ones) and `auth_verification` (single-use tokens are consumed by
  // deleting them; nothing writes there yet). Users, accounts, organisations, members and
  // invitations are never deleted by the app: removing a person or an organisation is an
  // operator task (apps/web switches off Better Auth's endpoints that would delete them). The
  // purge role touches none of them.
  auth_user: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'] },
  auth_session: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  auth_account: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'] },
  auth_verification: { tenancy: 'system', app: ['SELECT', 'INSERT', 'DELETE'] },
  auth_organization: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'] },
  auth_member: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'] },
  auth_invitation: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'] },
} as const satisfies Record<string, TableAccess>

/** Name of a table in schema `restro`. */
export type RestroTableName = keyof typeof TABLE_ACCESS

/**
 * The only tables the app role may DELETE from (D83, Martin 10-12): the three row kinds
 * `apply()` removes as the action itself, and Better Auth's session and verification rows.
 * Pinned by src/table-access.test.ts; widening it is a guardrail change.
 */
export const APP_DELETE_TABLES = [
  'auth_session',
  'auth_verification',
  'field_values',
  'placements',
  'source_links',
] as const

/**
 * The only routines in `restro` a role may EXECUTE, by signature, with their grantees; `pnpm
 * db:roles` revokes EXECUTE on every other routine. Today one: D121's guest lookup, the pinned
 * SECURITY DEFINER function (migration 0029, tests/rls-guard.test.ts). Adding one is a
 * guardrail change.
 */
export const ROUTINE_ACCESS = {
  'guest_table_by_code_hash(text)': [APP_ROLE],
} as const satisfies Record<string, readonly string[]>

/** Schema privileges of the app role. It may never CREATE in `restro`. */
export const APP_SCHEMA_PRIVILEGES = {
  [APP_SCHEMA]: ['USAGE'],
  // pg-boss creates and migrates its own tables at worker start (`createSchema: false`).
  [JOB_QUEUE_SCHEMA]: ['USAGE', 'CREATE'],
} as const satisfies Record<string, readonly ('USAGE' | 'CREATE')[]>

/** Schema privileges of the purge role: it only uses `restro`, and never the queue schema. */
export const PURGE_SCHEMA_PRIVILEGES = {
  [APP_SCHEMA]: ['USAGE'],
} as const satisfies Record<string, readonly ('USAGE' | 'CREATE')[]>
