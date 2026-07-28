CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rnc_id` integer NOT NULL,
	`user_name` text DEFAULT 'Acesso direto' NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`rnc_id`) REFERENCES `rncs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_rnc_idx` ON `audit_log` (`rnc_id`);--> statement-breakpoint
CREATE TABLE `email_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rnc_id` integer NOT NULL,
	`outlook_message_id` text,
	`event_type` text NOT NULL,
	`sender` text,
	`recipients` text,
	`subject` text,
	`summary` text,
	`occurred_at` text NOT NULL,
	`attachment_metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`rnc_id`) REFERENCES `rncs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_events_outlook_message_id_unique` ON `email_events` (`outlook_message_id`);--> statement-breakpoint
CREATE TABLE `rncs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` integer NOT NULL,
	`number` text NOT NULL,
	`year` integer NOT NULL,
	`description` text DEFAULT 'Descrição não identificada' NOT NULL,
	`type` text DEFAULT 'A classificar' NOT NULL,
	`received_at` text NOT NULL,
	`due_at` text NOT NULL,
	`sent_at` text,
	`returned_at` text,
	`status` text DEFAULT 'Recebida' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`response_owner` text DEFAULT '' NOT NULL,
	`analysis_owner` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rncs_work_number_year_unique` ON `rncs` (`work_id`,`number`,`year`);--> statement-breakpoint
CREATE INDEX `rncs_status_idx` ON `rncs` (`status`);--> statement-breakpoint
CREATE INDEX `rncs_due_at_idx` ON `rncs` (`due_at`);--> statement-breakpoint
CREATE TABLE `works` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `works_name_unique` ON `works` (`name`);