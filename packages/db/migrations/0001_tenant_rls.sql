-- Row-level security foundation. Hand-written (a drizzle-kit "custom" migration): drizzle-kit
-- cannot express FORCE ROW LEVEL SECURITY, and keeping policies out of the Drizzle schema means
-- drizzle-kit never tries to diff or drop them.
--
-- The current tenant is a transaction-local setting written by the tenant-scoped client
-- (packages/db/src/internal/pool.ts):  select set_config('app.tenant_id', $1, true)
-- current_setting('app.tenant_id', true) is NULL when the setting was never defined in the
-- session, and '' once a transaction that set it has ended. nullif(..., '') turns both into
-- NULL, and `tenant_id = NULL` matches nothing: with no tenant set, a tenant table returns zero
-- rows and rejects every write.
--
-- Roles and privileges are NOT set here: `pnpm db:roles` (scripts/roles.ts) owns them, from the
-- list in src/table-access.ts. This file only creates objects owned by the migration owner.

-- 1. The one-line RLS helper for every tenant table, now and in later migrations:
--      SELECT restro.enable_tenant_rls('restro.<table>');          -- tenant column tenant_id
--      SELECT restro.enable_tenant_rls('restro.tenants', 'id');    -- the tenant root itself
--    It enables and FORCES row-level security (so the table owner is held to it too) and
--    (re)creates the policy `tenant_isolation` for every command, with the same predicate for
--    reading (USING) and writing (WITH CHECK). packages/db/tests/rls-guard.test.ts fails if any
--    table with a tenant_id column is left without it.
CREATE FUNCTION restro.enable_tenant_rls(target regclass, tenant_column name DEFAULT 'tenant_id')
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  predicate text := format(
    '%I = nullif(current_setting(%L, true), %L)', tenant_column, 'app.tenant_id', ''
  );
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL USING (%s) WITH CHECK (%s)',
    target, predicate, predicate
  );
END
$$;
--> statement-breakpoint
-- Functions are executable by PUBLIC by default. Only the migration owner runs this one.
REVOKE ALL ON FUNCTION restro.enable_tenant_rls(regclass, name) FROM PUBLIC;
--> statement-breakpoint

-- 2. Tenant tables.
SELECT restro.enable_tenant_rls('restro.tenants', 'id');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.venues');
--> statement-breakpoint

-- 3. Templates: a tenant reads its own templates and the system ones (tenant_id NULL), and may
--    only add its own. There is no UPDATE or DELETE policy (and no such grant): rows are
--    immutable. System templates are added by the migration owner, never by the app.
ALTER TABLE restro.templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE restro.templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY templates_read ON restro.templates AS PERMISSIVE FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '') OR tenant_id IS NULL);
--> statement-breakpoint
CREATE POLICY templates_insert ON restro.templates AS PERMISSIVE FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint

-- 4. venues.updated_at follows every update, whatever code path writes the row.
CREATE FUNCTION restro.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION restro.touch_updated_at() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER venues_touch_updated_at BEFORE UPDATE ON restro.venues
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
--> statement-breakpoint

-- 5. Schemas. Nobody but the owner and the roles `pnpm db:roles` grants may use `restro`.
--    `pgboss` is created here by the owner; pg-boss creates its own tables in it at worker
--    start (as restro_app, which gets USAGE and CREATE on it, never on the database). The
--    worker must therefore start pg-boss with `createSchema: false`.
REVOKE ALL ON SCHEMA restro FROM PUBLIC;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS pgboss;
--> statement-breakpoint
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;
