-- Deleting a venue archives it (brief CF-18, D76, T77). Expand only: one nullable column, no backfill
-- (null = live, which is every venue today) and no new privilege: the app role keeps SELECT, INSERT
-- and UPDATE on `venues` and has no DELETE. `archived_at` is the time the venue was deleted; core's
-- `archiveVenue` and `restoreVenue` are the only writers of it.
ALTER TABLE "restro"."venues" ADD COLUMN "archived_at" timestamp with time zone;
