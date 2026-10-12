-- Removed POS instances (adjustments I1, D81; brief S1). Settings › Integrations can remove an
-- instance; the row is never erased (its credentials and what it synced stay until the purge job
-- clears them, D91), it is only marked: `removed_at` null = in use. A removed instance is hidden from
-- the admin and the worker's schedule leaves it alone. Core's `removeIntegration` is the only writer
-- and refuses while a venue still links to the instance. No new privilege: the app role already
-- UPDATEs `integrations`.
ALTER TABLE "restro"."integrations" ADD COLUMN "removed_at" timestamp with time zone;
