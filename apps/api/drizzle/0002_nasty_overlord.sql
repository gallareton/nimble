CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operator_label" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "fiat_amount_minor" integer;--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "fiat_currency" text;--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "fx_rate" text;--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "fx_rate_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "fx_source" text;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_user_id_user_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_shift_per_user" ON "shift" USING btree ("user_id") WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX "shift_user_idx" ON "shift" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;