CREATE TABLE `ft_work_edit_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`work_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`metadata_id` text,
	`previous_revision` integer NOT NULL,
	`revision` integer NOT NULL,
	`changed` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ft_work_edits_owner_key` ON `ft_work_edit_operations` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ft_work_edits_work` ON `ft_work_edit_operations` (`work_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ft_work_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`cover_key` text,
	`cover_mime` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ft_work_metadata_work` ON `ft_work_metadata` (`work_id`);--> statement-breakpoint
ALTER TABLE `ft_works` ADD `current_metadata_id` text;--> statement-breakpoint
ALTER TABLE `ft_works` ADD `initial_metadata_id` text;