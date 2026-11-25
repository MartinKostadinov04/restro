ALTER TABLE "restro"."spots" DROP CONSTRAINT "spots_shape";--> statement-breakpoint
ALTER TABLE "restro"."spots" DROP CONSTRAINT "spots_size";--> statement-breakpoint
ALTER TABLE "restro"."venue_spot_kinds" ADD COLUMN "symbol" text DEFAULT 'dot' NOT NULL;--> statement-breakpoint
ALTER TABLE "restro"."venue_spot_kinds" ADD COLUMN "filters" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_on_plan" CHECK ("restro"."spots"."x" >= 0 and "restro"."spots"."y" >= 0 and "restro"."spots"."x" + "restro"."spots"."width" <= 10000 and "restro"."spots"."y" + "restro"."spots"."height" <= 10000);--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_round" CHECK ("restro"."spots"."shape" <> 'circle' or "restro"."spots"."width" = "restro"."spots"."height");--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_turned" CHECK ("restro"."spots"."shape" <> 'circle' or "restro"."spots"."rotation" = 0);--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_shape" CHECK ("restro"."spots"."shape" in ('rect', 'circle', 'booth', 'pill'));--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_size" CHECK ("restro"."spots"."width" >= 2 and "restro"."spots"."height" >= 2);--> statement-breakpoint
ALTER TABLE "restro"."venue_spot_kinds" ADD CONSTRAINT "venue_spot_kinds_symbol" CHECK ("restro"."venue_spot_kinds"."symbol" in ('table', 'booth', 'stool', 'standing', 'counter', 'dot'));