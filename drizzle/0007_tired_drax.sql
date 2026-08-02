CREATE TABLE "api_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rnc_response_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"version" integer NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"content_base64" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_users" ADD COLUMN "allowed_works" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "location_front" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "contract" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "observations" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "photo_legend_1" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "photo_legend_2" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "photo_legend_3" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "photo_legend_4" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "internal_comment" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "inspection_date" text;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "inspection_owner" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rncs" ADD COLUMN "contract" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_documents" ADD CONSTRAINT "rnc_response_documents_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rnc_response_documents_number_unique" ON "rnc_response_documents" USING btree ("rnc_id","version");--> statement-breakpoint
CREATE INDEX "rnc_response_documents_rnc_idx" ON "rnc_response_documents" USING btree ("rnc_id");