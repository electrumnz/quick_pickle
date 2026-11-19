CREATE TABLE "xero_link" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"tenant_name" text,
	"tenants" text DEFAULT '[]' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"connected_by_name" text NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"lost_at" timestamp with time zone,
	"lost_reason" text,
	"sales_account" text,
	"delivery_account" text,
	"bank_account_id" text,
	"bank_account_name" text,
	"tax_type" text,
	"contact_name" text,
	"start_day" text,
	"last_round_at" timestamp with time zone,
	"last_round_said" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xero_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "xero_postings" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"order_id" text NOT NULL,
	"refund_id" text,
	"state" text NOT NULL,
	"xero_id" text,
	"payment_id" text,
	"trouble" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xero_postings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "xero_postings" ADD CONSTRAINT "xero_postings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_postings" ADD CONSTRAINT "xero_postings_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;