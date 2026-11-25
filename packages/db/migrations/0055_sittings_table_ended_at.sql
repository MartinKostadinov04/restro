-- The moved-party read of a closed table (P22, ticket #427) looks up a table's sittings that have
-- ended, newest first, inside a window. Until now no index served it: the open-sitting index is
-- partial (`ended_at is null`). An index only: no row changes, so no RLS wrap is needed.
CREATE INDEX "sittings_table_id_ended_at_idx" ON "restro"."sittings" USING btree ("table_id","ended_at");
