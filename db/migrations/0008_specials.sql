ALTER TABLE "promo_codes" ADD COLUMN "automatic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "public_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "crew_welcome" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_one_crew_welcome" ON "promo_codes" USING btree ("crew_welcome") WHERE "promo_codes"."crew_welcome";