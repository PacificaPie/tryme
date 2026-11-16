CREATE TABLE `ft_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`idempotency_key` text,
	`request_hash` text
);
--> statement-breakpoint
CREATE INDEX `ft_cards_owner_created` ON `ft_cards` (`author_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ft_cards_owner_key` ON `ft_cards` (`author_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `ft_events` (
	`id` text PRIMARY KEY NOT NULL,
	`client_event_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`work_id` text,
	`version_id` text,
	`card_id` text,
	`session_id` text,
	`event_type` text NOT NULL,
	`seq` integer,
	`elapsed_ms` integer,
	`result_json` text,
	`received_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `ft_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `ft_play_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ft_events_actor_client` ON `ft_events` (`actor_id`,`client_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ft_events_session_seq` ON `ft_events` (`session_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `ft_events_session_type` ON `ft_events` (`session_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `ft_events_work_received` ON `ft_events` (`work_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `ft_events_actor_received` ON `ft_events` (`actor_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `ft_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`client_event_id` text NOT NULL,
	`work_id` text NOT NULL,
	`version_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`text` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ft_feedback_author_client` ON `ft_feedback` (`author_id`,`client_event_id`);--> statement-breakpoint
CREATE INDEX `ft_feedback_work_created` ON `ft_feedback` (`work_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ft_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ft_play_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`work_id` text NOT NULL,
	`version_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ft_sessions_actor_created` ON `ft_play_sessions` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ft_work_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`version` text NOT NULL,
	`game_key` text,
	`cover_key` text,
	`cover_mime` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ft_versions_work` ON `ft_work_versions` (`work_id`);--> statement-breakpoint
CREATE TABLE `ft_works` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`source` text NOT NULL,
	`current_version_id` text NOT NULL,
	`url` text,
	`created_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ft_works_owner_key` ON `ft_works` (`author_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ft_works_owner_created` ON `ft_works` (`author_id`,`created_at`);