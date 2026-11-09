CREATE TABLE "restro"."floor_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"name" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floor_plans_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "floor_plans_id_format" CHECK ("restro"."floor_plans"."id" ~ '^fp_[0-9A-Za-z]+$'),
	CONSTRAINT "floor_plans_name" CHECK (length(btrim("restro"."floor_plans"."name")) between 1 and 60),
	CONSTRAINT "floor_plans_source" CHECK ("restro"."floor_plans"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "floor_plans_actor" CHECK ("restro"."floor_plans"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "floor_plans_job_id" CHECK ("restro"."floor_plans"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."guest_private_notes" (
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"guest_id" text NOT NULL,
	"staff_member_id" text NOT NULL,
	"note" text,
	"erased_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_private_notes_pkey" PRIMARY KEY("tenant_id","guest_id","staff_member_id"),
	CONSTRAINT "guest_private_notes_guest_id_format" CHECK ("restro"."guest_private_notes"."guest_id" ~ '^gu_[0-9A-Za-z]+$'),
	CONSTRAINT "guest_private_notes_staff_id_format" CHECK ("restro"."guest_private_notes"."staff_member_id" ~ '^sm_[0-9A-Za-z]+$'),
	CONSTRAINT "guest_private_notes_note" CHECK ("restro"."guest_private_notes"."note" is null or length("restro"."guest_private_notes"."note") <= 500),
	CONSTRAINT "guest_private_notes_erased_is_empty" CHECK ("restro"."guest_private_notes"."erased_at" is null or "restro"."guest_private_notes"."note" is null),
	CONSTRAINT "guest_private_notes_source" CHECK ("restro"."guest_private_notes"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "guest_private_notes_actor" CHECK ("restro"."guest_private_notes"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "guest_private_notes_job_id" CHECK ("restro"."guest_private_notes"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."guests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"phone_key" text,
	"name" text,
	"phone" text,
	"email" text,
	"note" text,
	"is_regular" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"erased_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guests_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "guests_id_format" CHECK ("restro"."guests"."id" ~ '^gu_[0-9A-Za-z]+$'),
	CONSTRAINT "guests_phone_key" CHECK ("restro"."guests"."phone_key" is null or "restro"."guests"."phone_key" ~ '^[0-9]{6,20}$'),
	CONSTRAINT "guests_name" CHECK ("restro"."guests"."name" is null or length(btrim("restro"."guests"."name")) between 1 and 80),
	CONSTRAINT "guests_phone" CHECK ("restro"."guests"."phone" is null or length("restro"."guests"."phone") <= 40),
	CONSTRAINT "guests_email" CHECK ("restro"."guests"."email" is null or length("restro"."guests"."email") <= 200),
	CONSTRAINT "guests_note" CHECK ("restro"."guests"."note" is null or length("restro"."guests"."note") <= 500),
	CONSTRAINT "guests_erased_is_empty" CHECK ("restro"."guests"."erased_at" is null or ("restro"."guests"."phone_key" is null and "restro"."guests"."name" is null and "restro"."guests"."phone" is null and "restro"."guests"."email" is null and "restro"."guests"."note" is null and not "restro"."guests"."is_regular")),
	CONSTRAINT "guests_key_present" CHECK ("restro"."guests"."erased_at" is not null or "restro"."guests"."phone_key" is not null),
	CONSTRAINT "guests_source" CHECK ("restro"."guests"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "guests_actor" CHECK ("restro"."guests"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "guests_job_id" CHECK ("restro"."guests"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."reservation_nights" (
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"service_date" date NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"closed_early" boolean DEFAULT false NOT NULL,
	"open_bills_at_close" integer,
	"swept_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_nights_pkey" PRIMARY KEY("tenant_id","venue_id","service_date"),
	CONSTRAINT "reservation_nights_closed_by" CHECK ("restro"."reservation_nights"."closed_by" is null or "restro"."reservation_nights"."closed_by" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "reservation_nights_closed_early" CHECK (not "restro"."reservation_nights"."closed_early" or "restro"."reservation_nights"."closed_at" is not null),
	CONSTRAINT "reservation_nights_open_bills" CHECK ("restro"."reservation_nights"."open_bills_at_close" is null or "restro"."reservation_nights"."open_bills_at_close" >= 0),
	CONSTRAINT "reservation_nights_source" CHECK ("restro"."reservation_nights"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "reservation_nights_actor" CHECK ("restro"."reservation_nights"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "reservation_nights_job_id" CHECK ("restro"."reservation_nights"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."reservation_settings" (
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"turn_minutes" integer NOT NULL,
	"edit_past_nights" boolean DEFAULT false NOT NULL,
	"private_notes_on" boolean DEFAULT false NOT NULL,
	"pin_actions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"online" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_settings_pkey" PRIMARY KEY("tenant_id","venue_id"),
	CONSTRAINT "reservation_settings_turn_minutes" CHECK ("restro"."reservation_settings"."turn_minutes" between 1 and 1440),
	CONSTRAINT "reservation_settings_pin_actions_object" CHECK (jsonb_typeof("restro"."reservation_settings"."pin_actions") = 'object'),
	CONSTRAINT "reservation_settings_online_object" CHECK (jsonb_typeof("restro"."reservation_settings"."online") = 'object'),
	CONSTRAINT "reservation_settings_source" CHECK ("restro"."reservation_settings"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "reservation_settings_actor" CHECK ("restro"."reservation_settings"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "reservation_settings_job_id" CHECK ("restro"."reservation_settings"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."reservation_spots" (
	"tenant_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"spot_id" text NOT NULL,
	"held_from" timestamp with time zone NOT NULL,
	"held_to" timestamp with time zone,
	"released_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_spots_pkey" PRIMARY KEY("tenant_id","reservation_id","spot_id","held_from"),
	CONSTRAINT "reservation_spots_reservation_id_format" CHECK ("restro"."reservation_spots"."reservation_id" ~ '^rv_[0-9A-Za-z]+$'),
	CONSTRAINT "reservation_spots_spot_id_format" CHECK ("restro"."reservation_spots"."spot_id" ~ '^sp_[0-9A-Za-z]+$'),
	CONSTRAINT "reservation_spots_held_to" CHECK ("restro"."reservation_spots"."held_to" is null or "restro"."reservation_spots"."held_to" > "restro"."reservation_spots"."held_from"),
	CONSTRAINT "reservation_spots_source" CHECK ("restro"."reservation_spots"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "reservation_spots_actor" CHECK ("restro"."reservation_spots"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "reservation_spots_job_id" CHECK ("restro"."reservation_spots"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"service_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"turn_minutes" integer,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"party_size" integer,
	"queue_key" text COLLATE "C",
	"guest_id" text,
	"party_label" text,
	"note" text,
	"reason" text,
	"made_by" text,
	"seated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"pay_rule" text,
	"prepay_minor" bigint,
	"prepay_currency" text,
	"prepay_state" text DEFAULT 'none' NOT NULL,
	"prepay_payment_id" text,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "reservations_id_format" CHECK ("restro"."reservations"."id" ~ '^rv_[0-9A-Za-z]+$'),
	CONSTRAINT "reservations_kind" CHECK ("restro"."reservations"."kind" in ('booking', 'walk_in', 'block')),
	CONSTRAINT "reservations_status" CHECK ("restro"."reservations"."status" in ('requested', 'reserved', 'waiting', 'seated', 'finished', 'no_show', 'cancelled', 'not_seated')),
	CONSTRAINT "reservations_block_status" CHECK ("restro"."reservations"."kind" <> 'block' or "restro"."reservations"."status" in ('reserved', 'finished', 'cancelled')),
	CONSTRAINT "reservations_party_size" CHECK (("restro"."reservations"."kind" = 'block') = ("restro"."reservations"."party_size" is null)),
	CONSTRAINT "reservations_party_size_range" CHECK ("restro"."reservations"."party_size" is null or "restro"."reservations"."party_size" between 1 and 500),
	CONSTRAINT "reservations_queue_key" CHECK (("restro"."reservations"."queue_key" is null or "restro"."reservations"."kind" = 'walk_in') and ("restro"."reservations"."status" <> 'waiting' or "restro"."reservations"."queue_key" is not null)),
	CONSTRAINT "reservations_queue_key_format" CHECK ("restro"."reservations"."queue_key" is null or "restro"."reservations"."queue_key" ~ '^[A-Za-z][0-9A-Za-z]*$'),
	CONSTRAINT "reservations_booking_party" CHECK ("restro"."reservations"."kind" <> 'booking' or "restro"."reservations"."guest_id" is not null or "restro"."reservations"."party_label" is not null),
	CONSTRAINT "reservations_guest_id_format" CHECK ("restro"."reservations"."guest_id" is null or "restro"."reservations"."guest_id" ~ '^gu_[0-9A-Za-z]+$'),
	CONSTRAINT "reservations_made_by_format" CHECK ("restro"."reservations"."made_by" is null or "restro"."reservations"."made_by" ~ '^sm_[0-9A-Za-z]+$'),
	CONSTRAINT "reservations_party_label" CHECK ("restro"."reservations"."party_label" is null or length(btrim("restro"."reservations"."party_label")) between 1 and 80),
	CONSTRAINT "reservations_note" CHECK ("restro"."reservations"."note" is null or length("restro"."reservations"."note") <= 500),
	CONSTRAINT "reservations_reason" CHECK ("restro"."reservations"."reason" is null or "restro"."reservations"."reason" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "reservations_turn_minutes" CHECK ("restro"."reservations"."turn_minutes" is null or "restro"."reservations"."turn_minutes" between 1 and 1440),
	CONSTRAINT "reservations_ends_after_starts" CHECK ("restro"."reservations"."ends_at" is null or "restro"."reservations"."ends_at" > "restro"."reservations"."starts_at"),
	CONSTRAINT "reservations_prepay_minor" CHECK ("restro"."reservations"."prepay_minor" is null or "restro"."reservations"."prepay_minor" >= 0),
	CONSTRAINT "reservations_prepay_pair" CHECK (("restro"."reservations"."prepay_minor" is null) = ("restro"."reservations"."prepay_currency" is null)),
	CONSTRAINT "reservations_prepay_currency" CHECK ("restro"."reservations"."prepay_currency" is null or "restro"."reservations"."prepay_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "reservations_prepay_state" CHECK ("restro"."reservations"."prepay_state" in ('none', 'asked', 'held', 'taken', 'released')),
	CONSTRAINT "reservations_prepay_payment_id" CHECK ("restro"."reservations"."prepay_payment_id" is null or "restro"."reservations"."prepay_payment_id" ~ '^py_[0-9A-Za-z]+$'),
	CONSTRAINT "reservations_pay_rule" CHECK ("restro"."reservations"."pay_rule" is null or "restro"."reservations"."pay_rule" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "reservations_source" CHECK ("restro"."reservations"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "reservations_actor" CHECK ("restro"."reservations"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "reservations_job_id" CHECK ("restro"."reservations"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."spots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"shape" text DEFAULT 'rect' NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"rotation" integer DEFAULT 0 NOT NULL,
	"seats" integer,
	"table_id" text,
	"removed_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spots_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "spots_id_format" CHECK ("restro"."spots"."id" ~ '^sp_[0-9A-Za-z]+$'),
	CONSTRAINT "spots_plan_id_format" CHECK ("restro"."spots"."plan_id" ~ '^fp_[0-9A-Za-z]+$'),
	CONSTRAINT "spots_table_id_format" CHECK ("restro"."spots"."table_id" is null or "restro"."spots"."table_id" ~ '^tb_[0-9A-Za-z]+$'),
	CONSTRAINT "spots_name" CHECK (length(btrim("restro"."spots"."name")) between 1 and 40),
	CONSTRAINT "spots_kind" CHECK ("restro"."spots"."kind" ~ '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT "spots_shape" CHECK ("restro"."spots"."shape" in ('rect', 'circle')),
	CONSTRAINT "spots_size" CHECK ("restro"."spots"."width" > 0 and "restro"."spots"."height" > 0),
	CONSTRAINT "spots_rotation" CHECK ("restro"."spots"."rotation" between 0 and 359),
	CONSTRAINT "spots_seats" CHECK ("restro"."spots"."seats" is null or "restro"."spots"."seats" between 1 and 100),
	CONSTRAINT "spots_source" CHECK ("restro"."spots"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "spots_actor" CHECK ("restro"."spots"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "spots_job_id" CHECK ("restro"."spots"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE TABLE "restro"."venue_spot_kinds" (
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"default_seats" integer,
	"sort_key" text COLLATE "C" DEFAULT 'a0' NOT NULL,
	"removed_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_spot_kinds_pkey" PRIMARY KEY("tenant_id","venue_id","key"),
	CONSTRAINT "venue_spot_kinds_key" CHECK ("restro"."venue_spot_kinds"."key" ~ '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT "venue_spot_kinds_label" CHECK (length(btrim("restro"."venue_spot_kinds"."label")) between 1 and 40),
	CONSTRAINT "venue_spot_kinds_default_seats" CHECK ("restro"."venue_spot_kinds"."default_seats" is null or "restro"."venue_spot_kinds"."default_seats" between 1 and 100),
	CONSTRAINT "venue_spot_kinds_sort_key_format" CHECK ("restro"."venue_spot_kinds"."sort_key" ~ '^[A-Za-z][0-9A-Za-z]*$'),
	CONSTRAINT "venue_spot_kinds_source" CHECK ("restro"."venue_spot_kinds"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "venue_spot_kinds_actor" CHECK ("restro"."venue_spot_kinds"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "venue_spot_kinds_job_id" CHECK ("restro"."venue_spot_kinds"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
ALTER TABLE "restro"."log_entries" DROP CONSTRAINT "log_entries_ids";--> statement-breakpoint
ALTER TABLE "restro"."log_entries" ADD COLUMN "reservation_id" text;--> statement-breakpoint
ALTER TABLE "restro"."log_entries" ADD COLUMN "guest_id" text;--> statement-breakpoint
ALTER TABLE "restro"."floor_plans" ADD CONSTRAINT "floor_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."floor_plans" ADD CONSTRAINT "floor_plans_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."guest_private_notes" ADD CONSTRAINT "guest_private_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."guest_private_notes" ADD CONSTRAINT "guest_private_notes_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."guest_private_notes" ADD CONSTRAINT "guest_private_notes_guest_fk" FOREIGN KEY ("tenant_id","guest_id") REFERENCES "restro"."guests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."guest_private_notes" ADD CONSTRAINT "guest_private_notes_staff_fk" FOREIGN KEY ("tenant_id","staff_member_id") REFERENCES "restro"."staff_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."guests" ADD CONSTRAINT "guests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."guests" ADD CONSTRAINT "guests_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservation_nights" ADD CONSTRAINT "reservation_nights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservation_nights" ADD CONSTRAINT "reservation_nights_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservation_settings" ADD CONSTRAINT "reservation_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservation_settings" ADD CONSTRAINT "reservation_settings_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservation_spots" ADD CONSTRAINT "reservation_spots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservation_spots" ADD CONSTRAINT "reservation_spots_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "restro"."reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservation_spots" ADD CONSTRAINT "reservation_spots_spot_fk" FOREIGN KEY ("tenant_id","spot_id") REFERENCES "restro"."spots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservations" ADD CONSTRAINT "reservations_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservations" ADD CONSTRAINT "reservations_guest_fk" FOREIGN KEY ("tenant_id","guest_id") REFERENCES "restro"."guests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."reservations" ADD CONSTRAINT "reservations_made_by_fk" FOREIGN KEY ("tenant_id","made_by") REFERENCES "restro"."staff_members"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "restro"."floor_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."spots" ADD CONSTRAINT "spots_table_fk" FOREIGN KEY ("tenant_id","table_id") REFERENCES "restro"."tables"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."venue_spot_kinds" ADD CONSTRAINT "venue_spot_kinds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."venue_spot_kinds" ADD CONSTRAINT "venue_spot_kinds_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "floor_plans_current_unique" ON "restro"."floor_plans" USING btree ("tenant_id","venue_id") WHERE "restro"."floor_plans"."is_current" and "restro"."floor_plans"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "floor_plans_venue_id_idx" ON "restro"."floor_plans" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_venue_phone_key_unique" ON "restro"."guests" USING btree ("tenant_id","venue_id","phone_key") WHERE "restro"."guests"."erased_at" is null;--> statement-breakpoint
CREATE INDEX "reservation_spots_spot_idx" ON "restro"."reservation_spots" USING btree ("spot_id","held_from") WHERE "restro"."reservation_spots"."released_at" is null;--> statement-breakpoint
CREATE INDEX "reservations_venue_service_date_idx" ON "restro"."reservations" USING btree ("venue_id","service_date","status");--> statement-breakpoint
CREATE INDEX "reservations_queue_idx" ON "restro"."reservations" USING btree ("venue_id","service_date","queue_key") WHERE "restro"."reservations"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "reservations_guest_id_idx" ON "restro"."reservations" USING btree ("guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spots_venue_name_unique" ON "restro"."spots" USING btree ("tenant_id","venue_id","name") WHERE "restro"."spots"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "spots_plan_id_idx" ON "restro"."spots" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "log_entries_reservation_id_idx" ON "restro"."log_entries" USING btree ("reservation_id","seq") WHERE "restro"."log_entries"."reservation_id" is not null;--> statement-breakpoint
ALTER TABLE "restro"."log_entries" ADD CONSTRAINT "log_entries_ids" CHECK (("restro"."log_entries"."sent_order_id" is null or "restro"."log_entries"."sent_order_id" ~ '^so_[0-9A-Za-z]+$') and ("restro"."log_entries"."payment_id" is null or "restro"."log_entries"."payment_id" ~ '^py_[0-9A-Za-z]+$') and ("restro"."log_entries"."table_id" is null or "restro"."log_entries"."table_id" ~ '^tb_[0-9A-Za-z]+$') and ("restro"."log_entries"."sitting_id" is null or "restro"."log_entries"."sitting_id" ~ '^st_[0-9A-Za-z]+$') and ("restro"."log_entries"."reservation_id" is null or "restro"."log_entries"."reservation_id" ~ '^rv_[0-9A-Za-z]+$') and ("restro"."log_entries"."guest_id" is null or "restro"."log_entries"."guest_id" ~ '^gu_[0-9A-Za-z]+$'));
--> statement-breakpoint
-- Row-level security (ticket #323; see src/table-access.ts): tenant isolation with FORCE on
-- every reservation table, like every other tenant table. The app role holds SELECT, INSERT
-- and UPDATE and never DELETE: a release, a removal, an archive and an erasure are all
-- updates (D83, D140, CLAUDE.md's never-list), and only the purge role removes a row.
SELECT restro.enable_tenant_rls('restro.floor_plans');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.spots');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.venue_spot_kinds');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.guests');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.reservations');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.reservation_spots');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.guest_private_notes');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.reservation_settings');--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.reservation_nights');
