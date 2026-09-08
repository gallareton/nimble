CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_charge_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"amount_atomic" bigint NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_original_charge_id_charge_id_fk" FOREIGN KEY ("original_charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_session_id_payment_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."payment_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_refund_per_session" ON "refund" USING btree ("session_id");