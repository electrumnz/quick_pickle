CREATE TABLE "courier_handoffs" (
	"order_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"state" text NOT NULL,
	"reference" text,
	"tries" integer DEFAULT 0 NOT NULL,
	"trouble" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "courier_handoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "courier_handoffs" ADD CONSTRAINT "courier_handoffs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courier_handoffs_state_idx" ON "courier_handoffs" USING btree ("state");