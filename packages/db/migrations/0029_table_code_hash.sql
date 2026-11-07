-- Table codes stop being looked up in plain (D121, D122 §9; ticket #70, the lead's part). Generated
-- by drizzle-kit, then edited by hand: the hash backfill runs before the new checks, and the guest
-- lookup function is appended. Existing codes keep their value, so no printed sticker changes;
-- their sealed copy is written later by the worker (#70), and only then does the plain
-- `qr_token` go.
--
-- `restro.guest_table_by_code_hash` is the one SECURITY DEFINER function in `restro` (D121, A6
-- G13; Martin agreed): it reads `tables` across tenants to find which tenant a guest's code
-- belongs to, so its owner must not be held to row-level security. tests/rls-guard.test.ts pins
-- it exactly; its only grantee (restro_app) comes from src/table-access.ts through `db:roles`.
ALTER TABLE "restro"."tables" DROP CONSTRAINT "tables_payment_table_no_code";--> statement-breakpoint
ALTER TABLE "restro"."tables" ADD COLUMN "qr_code_hash" text;--> statement-breakpoint
ALTER TABLE "restro"."tables" ADD COLUMN "qr_code_sealed" text;--> statement-breakpoint
-- The backfill runs with forced row-level security off for the owner (as 0019 and 0040 do; same transaction):
-- the owner of a hosted database has no BYPASSRLS, so under forced row-level security it would see and
-- change no row, and the `tables_qr_code_complete` check below would fail on any coded table.
ALTER TABLE "restro"."tables" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "restro"."tables" SET "qr_code_hash" = encode(sha256(convert_to("qr_token", 'UTF8')), 'hex') WHERE "qr_token" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "restro"."tables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."tables" ADD CONSTRAINT "tables_qr_code_hash_unique" UNIQUE("qr_code_hash");--> statement-breakpoint
ALTER TABLE "restro"."tables" ADD CONSTRAINT "tables_qr_code_hash_format" CHECK ("restro"."tables"."qr_code_hash" is null or "restro"."tables"."qr_code_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "restro"."tables" ADD CONSTRAINT "tables_qr_code_sealed_format" CHECK ("restro"."tables"."qr_code_sealed" is null or ("restro"."tables"."qr_code_sealed" ~ '^rs1\.' and length("restro"."tables"."qr_code_sealed") <= 1024));--> statement-breakpoint
ALTER TABLE "restro"."tables" ADD CONSTRAINT "tables_qr_code_complete" CHECK (("restro"."tables"."qr_code_hash" is null) = ("restro"."tables"."qr_token" is null and "restro"."tables"."qr_code_sealed" is null));--> statement-breakpoint
ALTER TABLE "restro"."tables" ADD CONSTRAINT "tables_payment_table_no_code" CHECK (not "restro"."tables"."is_payment_table" or "restro"."tables"."qr_code_hash" is null);--> statement-breakpoint
-- The guest lookup: a code's hash in, at most one row out (the hash is unique). `state` is `live`,
-- `hidden` (the table or its area is hidden) or `venue_not_live` (the venue is deleted or taken
-- offline). A deleted table, a payment table and an unknown hash give no row. Every name is
-- schema-qualified and the search path is pinned, so nothing a caller creates can stand in.
CREATE FUNCTION "restro"."guest_table_by_code_hash"(code_hash text)
RETURNS TABLE (tenant_id text, venue_id text, table_id text, code_generation integer, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, restro
AS $$
  SELECT t.tenant_id, t.venue_id, t.id, t.code_generation,
         CASE
           WHEN v.archived_at IS NOT NULL OR v.unpublished_at IS NOT NULL THEN 'venue_not_live'
           WHEN t.hidden OR a.hidden OR a.archived_at IS NOT NULL THEN 'hidden'
           ELSE 'live'
         END
  FROM restro.tables AS t
  JOIN restro.areas AS a ON a.tenant_id = t.tenant_id AND a.id = t.area_id
  JOIN restro.venues AS v ON v.tenant_id = t.tenant_id AND v.id = t.venue_id
  WHERE t.qr_code_hash = code_hash
    AND t.archived_at IS NULL
    AND NOT t.is_payment_table
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "restro"."guest_table_by_code_hash"(text) FROM PUBLIC;
