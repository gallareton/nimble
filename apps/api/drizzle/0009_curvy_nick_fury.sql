CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_minor" integer NOT NULL,
	"category" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_user_id" uuid NOT NULL,
	"shift_id" uuid,
	"status" text DEFAULT 'awaiting' NOT NULL,
	"payment_method" text NOT NULL,
	"total_minor" integer NOT NULL,
	"fiat_currency" text DEFAULT 'USD' NOT NULL,
	"charge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sale_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid,
	"name_snapshot" text NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_minor" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charge" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "charge_request" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_owner_user_id_user_profile_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_owner_user_id_user_profile_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_seller_user_id_user_profile_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."user_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_charge_id_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_owner_active_idx" ON "product" USING btree ("owner_user_id","active");--> statement-breakpoint
CREATE INDEX "sale_seller_created_idx" ON "sale" USING btree ("seller_user_id","created_at");--> statement-breakpoint
ALTER TABLE "charge" ADD CONSTRAINT "charge_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;