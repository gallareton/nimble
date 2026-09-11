ALTER TABLE "sale" ADD COLUMN "fx_rate" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "fx_rate_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "fx_source" text;