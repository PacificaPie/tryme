CREATE TABLE `ft_build_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`source_url` text NOT NULL,
	`repository` text NOT NULL,
	`commit_sha` text NOT NULL,
	`status` text NOT NULL,
	`logs` text DEFAULT '' NOT NULL,
	`error` text,
	`metadata_json` text,
	`artifact_key` text,
	`artifact_bytes` integer,
	`artifact_hash` text,
	`worker_id` text,
	`lease_id` text,
	`lease_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ft_build_jobs_owner_key` ON `ft_build_jobs` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ft_build_jobs_owner_created` ON `ft_build_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ft_build_jobs_queue` ON `ft_build_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ft_build_jobs_lease` ON `ft_build_jobs` (`worker_id`,`status`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `ft_build_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ft_build_workers_seen` ON `ft_build_workers` (`last_seen_at`);--> statement-breakpoint
ALTER TABLE `ft_work_versions` ADD `provenance_json` text;