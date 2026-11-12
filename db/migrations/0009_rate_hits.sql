CREATE TABLE "rate_hits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_hits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "rate_hits_window_idx" ON "rate_hits" USING btree ("window_start");