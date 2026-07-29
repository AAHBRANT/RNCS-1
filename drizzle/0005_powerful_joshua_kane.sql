CREATE TABLE "rnc_response_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"directive" text DEFAULT '' NOT NULL,
	"analysis" text DEFAULT '' NOT NULL,
	"actions_taken" text DEFAULT '' NOT NULL,
	"technical_response" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"conclusion" text DEFAULT '' NOT NULL,
	"agent_response" text DEFAULT '' NOT NULL,
	"email_body" text DEFAULT '' NOT NULL,
	"selected_attachments" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'Rascunho' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rnc_response_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"version" integer NOT NULL,
	"snapshot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD CONSTRAINT "rnc_response_drafts_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rnc_response_versions" ADD CONSTRAINT "rnc_response_versions_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rnc_response_drafts_rnc_unique" ON "rnc_response_drafts" USING btree ("rnc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rnc_response_versions_number_unique" ON "rnc_response_versions" USING btree ("rnc_id","version");--> statement-breakpoint
CREATE INDEX "rnc_response_versions_rnc_idx" ON "rnc_response_versions" USING btree ("rnc_id");