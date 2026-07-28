CREATE TABLE "outlook_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_message" text,
	CONSTRAINT "outlook_connections_account_email_unique" UNIQUE("account_email")
);
--> statement-breakpoint
CREATE TABLE "outlook_sync_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"folder_id" text NOT NULL,
	"folder_name" text NOT NULL,
	"folder_kind" text NOT NULL,
	"delta_link" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outlook_sync_folders" ADD CONSTRAINT "outlook_sync_folders_connection_id_outlook_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."outlook_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outlook_sync_folder_unique" ON "outlook_sync_folders" USING btree ("connection_id","folder_id");