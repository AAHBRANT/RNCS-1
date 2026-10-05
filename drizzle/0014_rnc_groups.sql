CREATE TABLE "rnc_group_members" (
	"rnc_id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rnc_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rnc_group_members" ADD CONSTRAINT "rnc_group_members_rnc_id_rncs_id_fk" FOREIGN KEY ("rnc_id") REFERENCES "public"."rncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rnc_group_members" ADD CONSTRAINT "rnc_group_members_group_id_rnc_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."rnc_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rnc_group_members_group_idx" ON "rnc_group_members" USING btree ("group_id");