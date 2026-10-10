-- Row-level security and housekeeping for the document tables of 0003 (brief S2-01).
-- Hand-written (a drizzle-kit "custom" migration), like 0001. Privileges are not set here:
-- `pnpm db:roles` grants exactly what src/table-access.ts lists.

-- 1. Every document table is tenant-scoped: ENABLE + FORCE row-level security and the
--    `tenant_isolation` policy on tenant_id, for reading and writing alike.
SELECT restro.enable_tenant_rls('restro.integrations');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.barsy_venues');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.nodes');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.menus');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.placements');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.source_records');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.source_links');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.field_values');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.events');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.job_runs');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.places');
--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.assets');
--> statement-breakpoint

-- 2. updated_at follows every update, whatever writes the row (the trigger function of 0001).
CREATE TRIGGER integrations_touch_updated_at BEFORE UPDATE ON restro.integrations
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER barsy_venues_touch_updated_at BEFORE UPDATE ON restro.barsy_venues
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER nodes_touch_updated_at BEFORE UPDATE ON restro.nodes
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER placements_touch_updated_at BEFORE UPDATE ON restro.placements
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER field_values_touch_updated_at BEFORE UPDATE ON restro.field_values
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER places_touch_updated_at BEFORE UPDATE ON restro.places
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER assets_touch_updated_at BEFORE UPDATE ON restro.assets
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
