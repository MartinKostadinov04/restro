-- A payment's lines stay claimed while it is `unconfirmed` (#244, repair-review RR-14; D127 3.1).
-- Written by hand: no table or column changes, so drizzle-kit has no snapshot to add. One transaction:
--   0. `payments` and `payment_lines` stop forcing row-level security on their owner for the length
--      of this transaction: on Supabase the owner has no BYPASSRLS, so the backfill would read and
--      touch no rows otherwise;
--   1. `payments_close_lines` fires when the payment reaches `captured`, `released`, `stranded` or
--      `capture_failed`, whoever writes it, instead of when `settled_at` is first set. `unconfirmed`
--      keeps `settled_at` and every column that reads it, so `payments_settled` (0030) stands
--      unchanged, and the function the trigger runs is 0032's. From `unconfirmed`, `settled_at` is
--      already set, so only the state can say when the payment has ended;
--   2. the backfill: a payment that has not ended claims its lines again, under this migration's
--      job. A line another payment has claimed since keeps that claim (`payment_lines_open_line_unique`
--      would refuse a second), and of two such payments on one line the older one claims it.
ALTER TABLE "restro"."payments" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."payment_lines" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP TRIGGER "payments_close_lines" ON "restro"."payments";--> statement-breakpoint
CREATE TRIGGER "payments_close_lines" AFTER UPDATE OF "state" ON "restro"."payments"
  FOR EACH ROW WHEN (OLD."state" IS DISTINCT FROM NEW."state"
    AND NEW."state" IN ('captured', 'released', 'stranded', 'capture_failed'))
  EXECUTE FUNCTION restro.close_payment_lines();--> statement-breakpoint

WITH "reclaimed" AS (
  SELECT "line"."tenant_id", "line"."payment_id", "line"."position",
         row_number() OVER (
           PARTITION BY "line"."tenant_id", "line"."venue_id", "line"."pos_line_ref"
           ORDER BY "payment"."created_at", "payment"."id"
         ) AS "turn",
         "line"."pos_line_ref"
    FROM "restro"."payment_lines" AS "line"
    JOIN "restro"."payments" AS "payment"
      ON "payment"."tenant_id" = "line"."tenant_id" AND "payment"."id" = "line"."payment_id"
   WHERE NOT "line"."open"
     AND "payment"."state" NOT IN ('captured', 'released', 'stranded', 'capture_failed')
     AND NOT EXISTS (
       SELECT 1 FROM "restro"."payment_lines" AS "other"
        WHERE "other"."open"
          AND "other"."tenant_id" = "line"."tenant_id"
          AND "other"."venue_id" = "line"."venue_id"
          AND "other"."pos_line_ref" = "line"."pos_line_ref"
     )
)
UPDATE "restro"."payment_lines" AS "line"
   SET "open" = true,
       "source" = 'restro',
       "actor" = 'system',
       "job_id" = 'migration:0044_unconfirmed_lines_stay_claimed'
  FROM "reclaimed"
 WHERE "line"."tenant_id" = "reclaimed"."tenant_id"
   AND "line"."payment_id" = "reclaimed"."payment_id"
   AND "line"."position" = "reclaimed"."position"
   AND ("reclaimed"."pos_line_ref" IS NULL OR "reclaimed"."turn" = 1);--> statement-breakpoint

ALTER TABLE "restro"."payment_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restro"."payments" FORCE ROW LEVEL SECURITY;
