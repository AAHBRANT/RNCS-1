ALTER TABLE "email_events" ADD COLUMN "in_reply_to" text;--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "references" text;--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "association_confidence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "field_confidence" text DEFAULT '{}' NOT NULL;