CREATE TABLE "page_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"when_kind" text NOT NULL,
	"when_value" text DEFAULT '' NOT NULL,
	"page_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "page_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"a_page_id" text,
	"b_page_id" text NOT NULL,
	"status" text DEFAULT 'off' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_events" ADD COLUMN "test" text;--> statement-breakpoint
ALTER TABLE "page_rules" ADD CONSTRAINT "page_rules_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_rules" ADD CONSTRAINT "page_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_tests" ADD CONSTRAINT "page_tests_a_page_id_pages_id_fk" FOREIGN KEY ("a_page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_tests" ADD CONSTRAINT "page_tests_b_page_id_pages_id_fk" FOREIGN KEY ("b_page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_tests" ADD CONSTRAINT "page_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_rules_order_idx" ON "page_rules" USING btree ("position");--> statement-breakpoint
CREATE UNIQUE INDEX "page_tests_one_running" ON "page_tests" USING btree ("status") WHERE "page_tests"."status" = 'running';