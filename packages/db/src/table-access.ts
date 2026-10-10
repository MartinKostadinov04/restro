// The security posture of every table in schema `restro`, in one reviewable list.
//
// - `tenancy` says how rows are isolated. `tenant` and `tenant-root` tables must have FORCE ROW
//   LEVEL SECURITY with policies on app.tenant_id (`SELECT restro.enable_tenant_rls(...)` in the
//   migration); `tenant-or-system` adds rows with a NULL tenant that every tenant may read;
//   `system` tables hold no tenant data at all and have no tenant_id column.
// - `app` lists the only table privileges the app role (`restro_app`) holds. `pnpm db:roles`
//   revokes everything else and fails if a table exists in the database but not here.
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

/** The schema that holds every Restro table. */
export const APP_SCHEMA = 'restro'

/** The schema pg-boss keeps its queue tables in. Created by the migration owner. */
export const JOB_QUEUE_SCHEMA = 'pgboss'

/** Table privileges that `pnpm db:roles` may grant. TRUNCATE (which ignores RLS) is not one. */
export type TablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

/** How a table's rows are kept apart between tenants. */
export type Tenancy = 'tenant-root' | 'tenant' | 'tenant-or-system' | 'system'

/** One table's isolation and the app role's privileges on it. */
export interface TableAccess {
  readonly tenancy: Tenancy
  readonly app: readonly TablePrivilege[]
}

/** Every table in schema `restro`, keyed by its Postgres name. */
export const TABLE_ACCESS = {
  // Rows are visible only while they are the current tenant (RLS on `id`). Tenants are created
  // inside their own tenant scope; deleting one is an operator task, not an app action.
  tenants: { tenancy: 'tenant-root', app: ['SELECT', 'INSERT', 'UPDATE'] },
  venues: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  // Immutable rows: no UPDATE, no DELETE.
  templates: { tenancy: 'tenant-or-system', app: ['SELECT', 'INSERT'] },
  // Upserted by the worker through withSystem().
  worker_heartbeats: { tenancy: 'system', app: ['SELECT', 'INSERT', 'UPDATE'] },

  // The menu document and its sources (brief S2-01). Every one is tenant-scoped with FORCE RLS
  // (migration 0004). Nothing here is ever deleted by the app except the rows whose removal is
  // the action itself: a placement (take an item out of a section), a field value (clearField,
  // unlink) and a source link (unlink).
  // Status and last check change; credentials are replaced; never deleted (disable instead).
  integrations: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  // Renamed, mapped to one of our venues, catalogue root chosen.
  barsy_venues: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  // A menu pins its venue, template and root node once (template migrations come later).
  menus: { tenancy: 'tenant', app: ['SELECT', 'INSERT'] },
  // Status and revision change; nodes are archived, never deleted.
  nodes: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  placements: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  field_values: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  // Tier 1 is append-only: a changed object is a new row.
  source_records: { tenancy: 'tenant', app: ['SELECT', 'INSERT'] },
  // The link lifecycle (active / missing / deleted, last seen) updates rows; unlink deletes one.
  source_links: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  // Append-only changelog (rule 2).
  events: { tenancy: 'tenant', app: ['SELECT', 'INSERT'] },
  job_runs: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  places: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  assets: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },

  // What was published (brief S3-01a; migration 0008). Snapshot bodies never change: UPDATE is
  // only for a held row's decision, and a trigger refuses any other change. Never deleted.
  snapshots: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  // One row per menu + venue, moved by every publish and rollback.
  publish_pointers: { tenancy: 'tenant', app: ['SELECT', 'INSERT', 'UPDATE'] },
  // Written once per item, never changed.
  item_first_published: { tenancy: 'tenant', app: ['SELECT', 'INSERT'] },

  // Better Auth (apps/web talks to these through its own pool on the app role). They are not
  // tenant-scoped: a person signs in before any tenant is known, and the organisation id is the
  // tenant id (see schema.ts). The app role can read every row of them, password hashes
  // included; that is what "not tenant-scoped" means, so keep Better Auth's endpoints narrow.
  // DELETE is granted only where a flow we keep needs it: `auth_session` (sign-out, revoking a
  // session, clearing expired ones) and `auth_verification` (single-use tokens are consumed by
  // deleting them; nothing writes there yet). Users, accounts, organisations, members and
  // invitations are never deleted by the app: removing a person or an organisation is an
  // operator task (apps/web switches off Better Auth's endpoints that would delete them).
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

/** Schema privileges of the app role. It may never CREATE in `restro`. */
export const APP_SCHEMA_PRIVILEGES = {
  [APP_SCHEMA]: ['USAGE'],
  // pg-boss creates and migrates its own tables at worker start (`createSchema: false`).
  [JOB_QUEUE_SCHEMA]: ['USAGE', 'CREATE'],
} as const satisfies Record<string, readonly ('USAGE' | 'CREATE')[]>
