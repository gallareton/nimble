ALTER TABLE "user_profile" ADD COLUMN "cashier_pin_hash" text;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "cashier_locked" boolean DEFAULT false NOT NULL;