CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"user_name" text DEFAULT 'Acesso direto' NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"rnc_id" integer NOT NULL,
	"outlook_message_id" text,
	"event_type" text NOT NULL,
	"sender" text,
	"recipients" text,
	"subject" text,
	"summary" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"attachment_metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_events_outlook_message_id_unique" UNIQUE("outlook_message_id")
);
--> statement-breakpoint
CREATE TABLE "rncs" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_id" integer NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"description" text DEFAULT 'Descrição não identificada' NOT NULL,
	"type" text DEFAULT 'A classificar' NOT NULL,
	"received_at" text NOT NULL,
	"due_at" text NOT NULL,
	"sent_at" text,
	"returned_at" text,
	"status" text DEFAULT 'Recebida' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"response_owner" text DEFAULT '' NOT NULL,
	"analysis_owner" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "works_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rncs" ADD CONSTRAINT "rncs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_rnc_idx" ON "audit_log" USING btree ("rnc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rncs_work_number_year_unique" ON "rncs" USING btree ("work_id","number","year");--> statement-breakpoint
CREATE INDEX "rncs_status_idx" ON "rncs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rncs_due_at_idx" ON "rncs" USING btree ("due_at");