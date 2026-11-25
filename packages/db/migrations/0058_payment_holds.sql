CREATE TABLE "restro"."payment_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"venue_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"handle_hash" text NOT NULL,
	"action_id" text,
	"amount_minor" bigint NOT NULL,
	"tip_minor" bigint DEFAULT 0 NOT NULL,
	"captured_minor" bigint,
	"currency" text NOT NULL,
	"provider_kind" text NOT NULL,
	"provider_payment_ref" text,
	"form_values" jsonb,
	"confirm_by" timestamp with time zone,
	"capture_before" timestamp with time zone,
	"three_ds_result" text,
	"authorisation_code" text,
	"settled_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_holds_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_holds_tenant_id_action_id_unique" UNIQUE("tenant_id","action_id"),
	CONSTRAINT "payment_holds_handle_hash_unique" UNIQUE("handle_hash"),
	CONSTRAINT "payment_holds_id_format" CHECK ("restro"."payment_holds"."id" ~ '^ph_[0-9A-Za-z]+$'),
	CONSTRAINT "payment_holds_state" CHECK ("restro"."payment_holds"."state" in ('requested', 'awaiting_guest', 'held', 'releasing', 'released', 'captured', 'capture_failed')),
	CONSTRAINT "payment_holds_reason" CHECK ("restro"."payment_holds"."reason" is null or "restro"."payment_holds"."reason" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
	CONSTRAINT "payment_holds_handle_hash" CHECK ("restro"."payment_holds"."handle_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "payment_holds_action_id" CHECK ("restro"."payment_holds"."action_id" is null or "restro"."payment_holds"."action_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
	CONSTRAINT "payment_holds_amounts" CHECK ("restro"."payment_holds"."tip_minor" >= 0 and "restro"."payment_holds"."amount_minor" > "restro"."payment_holds"."tip_minor"),
	CONSTRAINT "payment_holds_captured_minor" CHECK ("restro"."payment_holds"."captured_minor" is null or "restro"."payment_holds"."captured_minor" between 0 and "restro"."payment_holds"."amount_minor"),
	CONSTRAINT "payment_holds_currency" CHECK ("restro"."payment_holds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_holds_provider_kind" CHECK ("restro"."payment_holds"."provider_kind" ~ '^[a-z][a-z0-9-]{0,31}$'),
	CONSTRAINT "payment_holds_provider_payment_ref" CHECK ("restro"."payment_holds"."provider_payment_ref" is null or "restro"."payment_holds"."provider_payment_ref" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'),
	CONSTRAINT "payment_holds_form_values" CHECK ("restro"."payment_holds"."form_values" is null or ("restro"."payment_holds"."state" = 'awaiting_guest' and jsonb_typeof("restro"."payment_holds"."form_values") = 'object')),
	CONSTRAINT "payment_holds_evidence" CHECK (("restro"."payment_holds"."three_ds_result" is null or "restro"."payment_holds"."three_ds_result" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$') and ("restro"."payment_holds"."authorisation_code" is null or char_length("restro"."payment_holds"."authorisation_code") between 1 and 64)),
	CONSTRAINT "payment_holds_settled" CHECK (("restro"."payment_holds"."settled_at" is not null) = ("restro"."payment_holds"."state" in ('released', 'captured', 'capture_failed'))),
	CONSTRAINT "payment_holds_source" CHECK ("restro"."payment_holds"."source" in ('guest', 'staff', 'worker', 'provider', 'restro', 'pos')),
	CONSTRAINT "payment_holds_actor" CHECK ("restro"."payment_holds"."actor" ~ '^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$'),
	CONSTRAINT "payment_holds_job_id" CHECK ("restro"."payment_holds"."job_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$')
);
--> statement-breakpoint
ALTER TABLE "restro"."payment_steps" ADD COLUMN "hold_id" text;--> statement-breakpoint
ALTER TABLE "restro"."payments" ADD COLUMN "shared_minor" bigint;--> statement-breakpoint
ALTER TABLE "restro"."payments" ADD COLUMN "gathering_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restro"."payment_holds" ADD CONSTRAINT "payment_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."payment_holds" ADD CONSTRAINT "payment_holds_venue_fk" FOREIGN KEY ("tenant_id","venue_id") REFERENCES "restro"."venues"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."payment_holds" ADD CONSTRAINT "payment_holds_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "restro"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_holds_provider_payment_unique" ON "restro"."payment_holds" USING btree ("provider_kind","provider_payment_ref") WHERE "restro"."payment_holds"."provider_payment_ref" is not null;--> statement-breakpoint
CREATE INDEX "payment_holds_payment_idx" ON "restro"."payment_holds" USING btree ("tenant_id","payment_id");--> statement-breakpoint
ALTER TABLE "restro"."payment_steps" ADD CONSTRAINT "payment_steps_hold_fk" FOREIGN KEY ("tenant_id","hold_id") REFERENCES "restro"."payment_holds"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."payments" ADD CONSTRAINT "payments_group" CHECK ("restro"."payments"."shared_minor" is null or ("restro"."payments"."shared_minor" > 0 and "restro"."payments"."kind" = 'on_bill' and "restro"."payments"."provider_payment_ref" is null and "restro"."payments"."form_values" is null and "restro"."payments"."receipt_email" is null));--> statement-breakpoint
ALTER TABLE "restro"."payments" ADD CONSTRAINT "payments_gathering_ends_at" CHECK ("restro"."payments"."gathering_ends_at" is null or "restro"."payments"."shared_minor" is not null);--> statement-breakpoint
SELECT restro.enable_tenant_rls('restro.payment_holds');--> statement-breakpoint
CREATE TRIGGER payment_holds_touch_updated_at BEFORE UPDATE ON restro.payment_holds
  FOR EACH ROW EXECUTE FUNCTION restro.touch_updated_at();
