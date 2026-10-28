-- The payment provider's breaker (#112, D127 3.8): paying in the app pauses at one venue, never ordering.
ALTER TABLE "restro"."payment_accounts" ADD COLUMN "paying_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restro"."payment_accounts" ADD COLUMN "breaker" jsonb;--> statement-breakpoint
ALTER TABLE "restro"."payment_accounts" ADD CONSTRAINT "payment_accounts_breaker" CHECK ("restro"."payment_accounts"."breaker" is null or jsonb_typeof("restro"."payment_accounts"."breaker") = 'object');