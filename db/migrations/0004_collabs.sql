CREATE TABLE "partner_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "partner_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "commission_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "partner_id" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "promo_code_id" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "commission_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "partner_id" text;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "once_per_customer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_costs" ADD CONSTRAINT "partner_costs_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_costs" ADD CONSTRAINT "partner_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_costs_partner_idx" ON "partner_costs" USING btree ("partner_id","paid_on");--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_promo_idx" ON "orders" USING btree ("promo_code");--> statement-breakpoint
CREATE INDEX "orders_partner_idx" ON "orders" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "links_partner_idx" ON "links" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "promo_codes_partner_idx" ON "promo_codes" USING btree ("partner_id");