CREATE SCHEMA "restro";
--> statement-breakpoint
CREATE TABLE "restro"."templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_id_format" CHECK ("restro"."templates"."id" ~ '^tp_[0-9A-Za-z]+$'),
	CONSTRAINT "templates_version_positive" CHECK ("restro"."templates"."version" >= 1),
	CONSTRAINT "templates_definition_object" CHECK (jsonb_typeof("restro"."templates"."definition") = 'object')
);
--> statement-breakpoint
CREATE TABLE "restro"."tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_id_format" CHECK ("restro"."tenants"."id" ~ '^tn_[0-9A-Za-z]+$')
);
--> statement-breakpoint
CREATE TABLE "restro"."venues" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Sofia' NOT NULL,
	"service_day_ends_at" time DEFAULT '07:00' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"default_locale" text DEFAULT 'bg_BG' NOT NULL,
	"enabled_locales" text[] DEFAULT '{bg_BG,en_US}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_tenant_id_slug_unique" UNIQUE("tenant_id","slug"),
	CONSTRAINT "venues_id_format" CHECK ("restro"."venues"."id" ~ '^vn_[0-9A-Za-z]+$'),
	CONSTRAINT "venues_default_locale_enabled" CHECK ("restro"."venues"."default_locale" = any("restro"."venues"."enabled_locales"))
);
--> statement-breakpoint
CREATE TABLE "restro"."worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restro"."templates" ADD CONSTRAINT "templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restro"."venues" ADD CONSTRAINT "venues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "restro"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_owner_key_version_unique" ON "restro"."templates" USING btree (coalesce("tenant_id", ''),"key","version");