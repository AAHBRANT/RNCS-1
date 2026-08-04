ALTER TABLE "rncs" ADD COLUMN "issued_at" text;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "service_location" text DEFAULT '' NOT NULL;