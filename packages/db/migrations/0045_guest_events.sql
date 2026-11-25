CREATE TABLE "restro"."guest_events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "restro"."guest_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"service_date" date NOT NULL,
	"kind" text NOT NULL,
	"table_id" text NOT NULL,
	"sitting_id" text,
	"node_id" text,
	"amount_minor" bigint,
	"currency" text,
	"locale" text,
	"outcome" text,
	"retention" text NOT NULL,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	CONSTRAINT "guest_events_tenant_id_format" CHECK ("restro"."guest_events"."tenant_id" ~ '^tn_[0-9A-Za-z]+$'),
	CONSTRAINT "guest_events_venue_id_format" CHECK ("restro"."guest_events"."venue_id" ~ '^vn_[0-9A-Za-z]+$'),
	CONSTRAINT "guest_events_kind" CHECK ("restro"."guest_events"."kind" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
	CONSTRAINT "guest_events_ids" CHECK ("restro"."guest_events"."table_id" ~ '^tb_[0-9A-Za-z]+$' and ("restro"."guest_events"."sitting_id" is null or "restro"."guest_events"."sitting_id" ~ '^st_[0-9A-Za-z]+$') and ("restro"."guest_events"."node_id" is null or "restro"."guest_events"."node_id" ~ '^nd_[0-9A-Za-z]+$')),
	CONSTRAINT "guest_events_amount_minor" CHECK ("restro"."guest_events"."amount_minor" is null or "restro"."guest_events"."amount_minor" >= 0),
	CONSTRAINT "guest_events_amount_currency_pair" CHECK (("restro"."guest_events"."amount_minor" is null) = ("restro"."guest_events"."currency" is null)),
	CONSTRAINT "guest_events_currency" CHECK ("restro"."guest_events"."currency" is null or "restro"."guest_events"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "guest_events_locale" CHECK ("restro"."guest_events"."locale" is null or "restro"."guest_events"."locale" ~ '^[a-z]{2}_[A-Z]{2}$'),
	CONSTRAINT "guest_events_outcome" CHECK ("restro"."guest_events"."outcome" is null or "restro"."guest_events"."outcome" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "guest_events_retention" CHECK ("restro"."guest_events"."retention" in ('night', 'record')),
	CONSTRAINT "guest_events_source" CHECK ("restro"."guest_events"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "guest_events_actor" CHECK ("restro"."guest_events"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "guest_events_job_id" CHECK ("restro"."guest_events"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
CREATE INDEX "guest_events_venue_service_date_kind_idx" ON "restro"."guest_events" USING btree ("venue_id","service_date","kind");--> statement-breakpoint
CREATE INDEX "guest_events_venue_table_at_idx" ON "restro"."guest_events" USING btree ("venue_id","table_id","at");--> statement-breakpoint
CREATE INDEX "guest_events_retention_service_date_idx" ON "restro"."guest_events" USING btree ("retention","service_date");--> statement-breakpoint
-- Row-level security (D142; see src/table-access.ts): tenant isolation with FORCE, like every
-- other tenant table. The app role holds SELECT and INSERT only (append-only, rule 1); the purge
-- role erases a venue's rows by their retention class (D83).
SELECT restro.enable_tenant_rls('restro.guest_events');
