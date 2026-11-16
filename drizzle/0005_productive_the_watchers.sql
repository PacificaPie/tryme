CREATE TABLE `ft_version_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`work_id` text NOT NULL,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`from_version_id` text NOT NULL,
	`to_version_id` text NOT NULL,
	`previous_revision` integer NOT NULL,
	`revision` integer NOT NULL,
	`changed` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ft_version_operations_owner_key` ON `ft_version_operations` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ft_version_operations_work_created` ON `ft_version_operations` (`work_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ft_work_versions` ADD `ordinal` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ft_work_versions` ADD `release_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ft_work_versions` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `ft_work_versions` ADD `created_by` text;--> statement-breakpoint
-- Preserve all existing identifiers and labels. Old artifacts have unknown hashes.
UPDATE `ft_work_versions` SET `ordinal`=(SELECT COUNT(*) FROM `ft_work_versions` prior WHERE prior.work_id=ft_work_versions.work_id AND (prior.created_at<ft_work_versions.created_at OR (prior.created_at=ft_work_versions.created_at AND prior.id<=ft_work_versions.id))),
`created_by`=(SELECT author_id FROM ft_works WHERE id=ft_work_versions.work_id);--> statement-breakpoint
CREATE UNIQUE INDEX `ft_versions_work_ordinal` ON `ft_work_versions` (`work_id`,`ordinal`);--> statement-breakpoint
ALTER TABLE `ft_works` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ft_works` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `ft_works` SET `updated_at`=`created_at`;
