-- Reverse of migrations/0014_till_role.sql (brief CF-03). NOT run by `pnpm db:migrate`: run it by
-- hand, as the migration owner, in one transaction, only together with reverting the code to
-- before CF-03, and only on a local or test database (staging needs Martin's OK, CLAUDE.md).
--
-- It restores the checks and stored values from before 0014, minus the `import` layer and
-- `import:<profile>` sources (spreadsheet import stays dropped, D65): the layer `till` becomes
-- `barsy` again, sources `till:<in_>` become `barsy:<in_>` (also in link events), asset origin
-- `connector` becomes `barsy`, and the constraints get their old names. Every other column is
-- left as it was (the `updated_at` triggers are paused, as in 0014). Finally it forgets 0014 in
-- Drizzle's journal, so a later `pnpm db:migrate` applies 0014 again.
--
-- Statements are separated by Drizzle's statement breakpoint markers, like a migration's, so the
-- DB test can run them one by one (packages/db/tests/till-role-migration.test.ts).

ALTER TABLE "restro"."field_values" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."events" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."assets" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."field_values" DISABLE TRIGGER "field_values_touch_updated_at";--> statement-breakpoint
ALTER TABLE "restro"."assets" DISABLE TRIGGER "assets_touch_updated_at";--> statement-breakpoint

-- 1. Drop the checks of 0014.
ALTER TABLE "restro"."assets" DROP CONSTRAINT "assets_origin";--> statement-breakpoint
ALTER TABLE "restro"."events" DROP CONSTRAINT "events_layer";--> statement-breakpoint
ALTER TABLE "restro"."events" DROP CONSTRAINT "events_source";--> statement-breakpoint
ALTER TABLE "restro"."field_values" DROP CONSTRAINT "field_values_venue_scope_till_only";--> statement-breakpoint
ALTER TABLE "restro"."field_values" DROP CONSTRAINT "field_values_till_provenance";--> statement-breakpoint
ALTER TABLE "restro"."field_values" DROP CONSTRAINT "field_values_layer";--> statement-breakpoint
ALTER TABLE "restro"."field_values" DROP CONSTRAINT "field_values_source";--> statement-breakpoint
ALTER TABLE "restro"."field_values" DROP CONSTRAINT "field_values_layer_matches_source";--> statement-breakpoint

-- 2. Restore the stored values.
UPDATE "restro"."field_values" SET "layer" = 'barsy' WHERE "layer" = 'till';--> statement-breakpoint
UPDATE "restro"."field_values" SET "source" = 'barsy:' || substr("source", 6) WHERE "source" LIKE 'till:%';--> statement-breakpoint
UPDATE "restro"."events" SET "layer" = 'barsy' WHERE "layer" = 'till';--> statement-breakpoint
UPDATE "restro"."events" SET "source" = 'barsy:' || substr("source", 6) WHERE "source" LIKE 'till:%';--> statement-breakpoint
UPDATE "restro"."events"
SET "old_value" = jsonb_set("old_value", '{source}', to_jsonb('barsy:' || substr("old_value" ->> 'source', 6)))
WHERE "op" IN ('linkSource', 'unlinkSource', 'setLinkState')
  AND jsonb_typeof("old_value") = 'object'
  AND "old_value" ->> 'source' LIKE 'till:%';--> statement-breakpoint
UPDATE "restro"."events"
SET "new_value" = jsonb_set("new_value", '{source}', to_jsonb('barsy:' || substr("new_value" ->> 'source', 6)))
WHERE "op" IN ('linkSource', 'unlinkSource', 'setLinkState')
  AND jsonb_typeof("new_value") = 'object'
  AND "new_value" ->> 'source' LIKE 'till:%';--> statement-breakpoint
UPDATE "restro"."assets" SET "origin" = 'barsy' WHERE "origin" = 'connector';--> statement-breakpoint

-- 3. The checks from before 0014 (migration 0003), without `import`.
ALTER TABLE "restro"."assets" ADD CONSTRAINT "assets_origin" CHECK ("restro"."assets"."origin" in ('upload', 'barsy'));--> statement-breakpoint
ALTER TABLE "restro"."events" ADD CONSTRAINT "events_layer" CHECK ("restro"."events"."layer" in ('barsy', 'manual', 'override') or "restro"."events"."layer" ~ '^edition:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');--> statement-breakpoint
ALTER TABLE "restro"."events" ADD CONSTRAINT "events_source" CHECK ("restro"."events"."source" = 'manual' or "restro"."events"."source" ~ '^barsy:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');--> statement-breakpoint
ALTER TABLE "restro"."field_values" ADD CONSTRAINT "field_values_venue_scope_barsy_only" CHECK ("restro"."field_values"."scope" = 'master' or "restro"."field_values"."layer" = 'barsy');--> statement-breakpoint
ALTER TABLE "restro"."field_values" ADD CONSTRAINT "field_values_barsy_provenance" CHECK ("restro"."field_values"."layer" <> 'barsy' or ("restro"."field_values"."source_record_id" is not null and "restro"."field_values"."mapping_version" is not null));--> statement-breakpoint
ALTER TABLE "restro"."field_values" ADD CONSTRAINT "field_values_layer" CHECK ("restro"."field_values"."layer" in ('barsy', 'manual', 'override') or "restro"."field_values"."layer" ~ '^edition:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');--> statement-breakpoint
ALTER TABLE "restro"."field_values" ADD CONSTRAINT "field_values_source" CHECK ("restro"."field_values"."source" = 'manual' or "restro"."field_values"."source" ~ '^barsy:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$');--> statement-breakpoint
ALTER TABLE "restro"."field_values" ADD CONSTRAINT "field_values_layer_matches_source" CHECK (("restro"."field_values"."layer" = 'barsy') = ("restro"."field_values"."source" like 'barsy:%'));--> statement-breakpoint

-- 4. Post-check: no till layer, source or origin is left.
DO $$
DECLARE
  left_over bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM restro.field_values WHERE layer = 'till' OR source LIKE 'till:%')
    + (SELECT count(*) FROM restro.events WHERE layer = 'till' OR source LIKE 'till:%')
    + (SELECT count(*) FROM restro.events
         WHERE op IN ('linkSource', 'unlinkSource', 'setLinkState')
           AND (old_value ->> 'source' LIKE 'till:%' OR new_value ->> 'source' LIKE 'till:%'))
    + (SELECT count(*) FROM restro.assets WHERE origin = 'connector')
  INTO left_over;
  IF left_over > 0 THEN
    RAISE EXCEPTION '0014_till_role.down: % rows still name the till layer, source or origin', left_over;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "restro"."field_values" ENABLE TRIGGER "field_values_touch_updated_at";--> statement-breakpoint
ALTER TABLE "restro"."assets" ENABLE TRIGGER "assets_touch_updated_at";--> statement-breakpoint
ALTER TABLE "restro"."field_values" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 5. Forget 0014 in Drizzle's journal (its `created_at` is the journal's `when` of 0014).
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791700161310;
  END IF;
END
$$;
