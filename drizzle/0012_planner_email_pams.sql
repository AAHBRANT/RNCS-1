ALTER TABLE "planner_pams" ALTER COLUMN "response_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "planner_pams" ADD COLUMN "source" text DEFAULT 'SISTEMA' NOT NULL;--> statement-breakpoint
ALTER TABLE "planner_pams" ADD COLUMN "email_event_id" integer;--> statement-breakpoint
ALTER TABLE "planner_pams" ADD COLUMN "attachment_id" text;--> statement-breakpoint
ALTER TABLE "planner_pams" ADD COLUMN "attachment_name" text;--> statement-breakpoint
ALTER TABLE "planner_pams" ADD COLUMN "document_date" text;--> statement-breakpoint
CREATE UNIQUE INDEX "planner_pams_email_unique" ON "planner_pams" USING btree ("email_event_id","attachment_name");