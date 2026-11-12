CREATE TABLE "file_blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_blobs" ENABLE ROW LEVEL SECURITY;