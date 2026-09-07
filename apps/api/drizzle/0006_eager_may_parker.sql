CREATE TABLE "charge_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receiver_user_id" uuid NOT NULL,
	"amount_atomic" bigint NOT NULL,
	"fiat_amount_minor" integer,
	"fiat_currency" text,
	"fx_rate" text,
	"fx_rate_at" timestamp with time zone,
	"fx_source" text,
	"reference" text,
	"expires_at" timestamp with time zone NOT NULL,
	"session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charge_request" ADD CONSTRAINT "charge_request_receiver_user_id_user_profile_id_fk" FOREIGN KEY ("receiver_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_request" ADD CONSTRAINT "charge_request_session_id_payment_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."payment_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_session_per_request" ON "charge_request" USING btree ("session_id") WHERE session_id is not null;