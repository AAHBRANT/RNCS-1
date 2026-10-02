CREATE TABLE "rnc_comments" (
	"rnc_id" integer PRIMARY KEY NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rnc_comments" ADD CONSTRAINT "rnc_comments_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;