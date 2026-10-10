ALTER TABLE "restro"."events" ADD COLUMN "op" text DEFAULT 'setField' NOT NULL;--> statement-breakpoint
ALTER TABLE "restro"."events" ADD CONSTRAINT "events_op" CHECK ("restro"."events"."op" in ('setField', 'clearField', 'createNode', 'setPlacement', 'removePlacement', 'moveNode', 'setNodeStatus', 'linkSource', 'unlinkSource'));
