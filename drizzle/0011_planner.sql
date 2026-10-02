CREATE TABLE "planner_commitments" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"planner_pam_id" integer NOT NULL,
	"pam_version" integer NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'ETAPA' NOT NULL,
	"source" text DEFAULT 'PROPOSTA' NOT NULL,
	"title" text NOT NULL,
	"original_text" text DEFAULT '' NOT NULL,
	"quantity" integer,
	"unit" text DEFAULT 'CORRIDOS' NOT NULL,
	"base_type" text DEFAULT 'PAM_SENT_DATE' NOT NULL,
	"fixed_date" text,
	"milestone_label" text,
	"milestone_date" text,
	"predecessor_id" integer,
	"extracted" text DEFAULT '{}' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"review_reason" text,
	"base_date" text,
	"calculated_due" text,
	"original_due" text,
	"current_due" text,
	"is_projected" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'OK' NOT NULL,
	"manual_adjust" boolean DEFAULT false NOT NULL,
	"adjusted_due" text,
	"adjusted_by" text,
	"adjusted_at" timestamp with time zone,
	"adjust_reason" text,
	"status" text DEFAULT 'PENDENTE' NOT NULL,
	"completed_at" text,
	"completed_by" text,
	"completed_registered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_pams" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"response_version_id" integer NOT NULL,
	"pam_version" integer NOT NULL,
	"sent_at" text,
	"sent_source" text,
	"sent_event_id" integer,
	"sent_adjusted_by" text,
	"sent_adjust_reason" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"status" text DEFAULT 'ATIVO' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planner_commitments" ADD CONSTRAINT "planner_commitments_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_commitments" ADD CONSTRAINT "planner_commitments_planner_pam_id_planner_pams_id_fk" FOREIGN KEY ("planner_pam_id") REFERENCES "public"."planner_pams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_pams" ADD CONSTRAINT "planner_pams_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planner_pams" ADD CONSTRAINT "planner_pams_response_version_id_rnc_response_versions_id_fk" FOREIGN KEY ("response_version_id") REFERENCES "public"."rnc_response_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planner_commitments_rnc_idx" ON "planner_commitments" USING btree ("rnc_id");--> statement-breakpoint
CREATE INDEX "planner_commitments_pam_idx" ON "planner_commitments" USING btree ("planner_pam_id");--> statement-breakpoint
CREATE INDEX "planner_commitments_due_idx" ON "planner_commitments" USING btree ("current_due");--> statement-breakpoint
CREATE UNIQUE INDEX "planner_pams_version_unique" ON "planner_pams" USING btree ("response_version_id");--> statement-breakpoint
CREATE INDEX "planner_pams_rnc_idx" ON "planner_pams" USING btree ("rnc_id");