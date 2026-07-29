CREATE TABLE "access_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"allowed_types" text DEFAULT '[]' NOT NULL,
	"can_view_all" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rnc_response_drafts" ADD COLUMN "updated_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "rnc_response_versions" ADD COLUMN "created_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "access_users_email_unique" ON "access_users" USING btree ("email");