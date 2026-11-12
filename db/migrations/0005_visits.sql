ALTER TABLE "page_events" ADD COLUMN "page" text DEFAULT 'home' NOT NULL;--> statement-breakpoint
CREATE INDEX "page_events_kind_idx" ON "page_events" USING btree ("kind","at");