ALTER TABLE "charge" ADD COLUMN "receiver_business_name" text;--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "receiver_tax_id" text;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "business_name" text;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "business_address" text;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "tax_id" text;