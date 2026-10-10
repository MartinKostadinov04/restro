-- Photo variants and the decision note (brief S3-01b): assets.variants records the webp files made
-- for the publish store; snapshots.decision_note says why the system turned a held row down. The
-- guard trigger of 0008 compares only the columns it names, so a decision may carry the note.
ALTER TABLE "restro"."assets" ADD COLUMN "variants" jsonb;--> statement-breakpoint
ALTER TABLE "restro"."snapshots" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "restro"."assets" ADD CONSTRAINT "assets_variants_object" CHECK ("restro"."assets"."variants" is null or jsonb_typeof("restro"."assets"."variants") = 'object');--> statement-breakpoint
ALTER TABLE "restro"."snapshots" ADD CONSTRAINT "snapshots_decision_note" CHECK ("restro"."snapshots"."decision_note" is null or ("restro"."snapshots"."decided_by" is not null and "restro"."snapshots"."decision_note" ~ '^[a-z][a-z0-9_]{0,63}$'));