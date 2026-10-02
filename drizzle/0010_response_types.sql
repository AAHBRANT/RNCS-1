DROP INDEX "rnc_response_documents_number_unique";--> statement-breakpoint
DROP INDEX "rnc_response_drafts_rnc_unique";--> statement-breakpoint
DROP INDEX "rnc_response_versions_number_unique";--> statement-breakpoint
ALTER TABLE "rnc_response_documents" ADD COLUMN "response_type" text DEFAULT 'TRATATIVA' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "response_type" text DEFAULT 'TRATATIVA' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "form_data" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_versions" ADD COLUMN "response_type" text DEFAULT 'TRATATIVA' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_versions" ADD COLUMN "response_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rnc_response_documents_type_number_unique" ON "rnc_response_documents" USING btree ("rnc_id","response_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rnc_response_drafts_rnc_type_unique" ON "rnc_response_drafts" USING btree ("rnc_id","response_type");--> statement-breakpoint
CREATE UNIQUE INDEX "rnc_response_versions_type_number_unique" ON "rnc_response_versions" USING btree ("rnc_id","response_type","version");