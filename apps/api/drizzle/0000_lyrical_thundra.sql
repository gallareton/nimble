CREATE TABLE "auth_nonce" (
	"nonce" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chain_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charge_id" uuid NOT NULL,
	"network" text DEFAULT 'nimiq' NOT NULL,
	"asset" text DEFAULT 'NIM' NOT NULL,
	"sender" text NOT NULL,
	"recipient" text NOT NULL,
	"amount_atomic" bigint NOT NULL,
	"fee_atomic" bigint,
	"hash" text NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"amount_atomic" bigint NOT NULL,
	"pricing_currency" text DEFAULT 'NIM' NOT NULL,
	"accepted_assets" text[] DEFAULT ARRAY['NIM'] NOT NULL,
	"selected_asset" text DEFAULT 'NIM' NOT NULL,
	"recipient_address" text NOT NULL,
	"reference" text,
	"reconciliation_token" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "charge_reconciliation_token_unique" UNIQUE("reconciliation_token")
);
--> statement-breakpoint
CREATE TABLE "claim_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_record" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_code" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payer_user_id" uuid NOT NULL,
	"receiver_user_id" uuid,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"charge_deadline_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"state_from" text,
	"state_to" text,
	"safe_metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"display_name" text,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"preferred_fiat" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
ALTER TABLE "chain_transaction" ADD CONSTRAINT "chain_transaction_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_session_id_payment_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."payment_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_session" ADD CONSTRAINT "payment_session_payer_user_id_user_profile_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_session" ADD CONSTRAINT "payment_session_receiver_user_id_user_profile_id_fk" FOREIGN KEY ("receiver_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_transaction_id_chain_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."chain_transaction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_owner_user_id_user_profile_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_session_id_payment_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."payment_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tx_network_hash" ON "chain_transaction" USING btree ("network","hash");--> statement-breakpoint
CREATE INDEX "claim_attempt_subject_idx" ON "claim_attempt" USING btree ("subject_type","subject_hash","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idem_scope_key" ON "idempotency_record" USING btree ("scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "one_available_code_per_payer" ON "payment_session" USING btree ("payer_user_id") WHERE status = 'AVAILABLE';--> statement-breakpoint
CREATE INDEX "session_code_hash_idx" ON "payment_session" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "session_status_idx" ON "payment_session" USING btree ("status");