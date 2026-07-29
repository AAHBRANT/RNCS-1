CREATE TABLE "rnc_conflicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"field" text NOT NULL,
	"candidate_values" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"folders_checked" text DEFAULT '[]' NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"message" text
);
--> statement-breakpoint
ALTER TABLE "email_events" DROP CONSTRAINT "email_events_outlook_message_id_unique";--> statement-breakpoint
ALTER TABLE "email_events" ALTER COLUMN "outlook_message_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "internet_message_id" text;--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "folder_name" text;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "field_sources" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "manual_fields" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "source_summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_conflicts" ADD CONSTRAINT "rnc_conflicts_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_outlook_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."outlook_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_rnc_message_unique" ON "email_events" USING btree ("rnc_id","outlook_message_id");--> statement-breakpoint
CREATE INDEX "email_events_rnc_occurred_idx" ON "email_events" USING btree ("rnc_id","occurred_at");