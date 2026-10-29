ALTER TABLE "restro"."payment_lines" ADD COLUMN "name" jsonb;--> statement-breakpoint
ALTER TABLE "restro"."payment_lines" ADD COLUMN "closed_minor" bigint;--> statement-breakpoint
ALTER TABLE "restro"."payment_lines" ADD COLUMN "closed_quantity" numeric(21, 6);--> statement-breakpoint
ALTER TABLE "restro"."payment_lines" ADD CONSTRAINT "payment_lines_closed" CHECK (("restro"."payment_lines"."closed_minor" is null) = ("restro"."payment_lines"."closed_quantity" is null) and ("restro"."payment_lines"."closed_quantity" is null or "restro"."payment_lines"."closed_quantity" > 0));--> statement-breakpoint
ALTER TABLE "restro"."payment_lines" ADD CONSTRAINT "payment_lines_name" CHECK ("restro"."payment_lines"."name" is null or (jsonb_typeof("restro"."payment_lines"."name") = 'object' and "restro"."payment_lines"."name" <> '{}'::jsonb));--> statement-breakpoint
-- Lines of payments the POS already closed before this migration were closed as picked: the
-- picked amount and quantity stand as what was closed, so a captured one still reads as paid.
UPDATE "restro"."payment_lines" AS "line" SET "closed_minor" = "line"."pos_amount_minor", "closed_quantity" = "line"."quantity" FROM "restro"."payments" AS "payment" WHERE "payment"."tenant_id" = "line"."tenant_id" AND "payment"."id" = "line"."payment_id" AND "payment"."state" IN ('checked', 'closed', 'unconfirmed', 'captured');--> statement-breakpoint
-- The name the guest saw becomes a one-language name under the venue's default language; "Other item" (D75) becomes null.
UPDATE "restro"."payment_lines" AS "line" SET "name" = CASE WHEN "line"."display_name" = 'Other item' THEN NULL ELSE jsonb_build_object("venue"."default_locale", "line"."display_name") END FROM "restro"."venues" AS "venue" WHERE "venue"."tenant_id" = "line"."tenant_id" AND "venue"."id" = "line"."venue_id";
