CREATE TABLE `ft_comment_likes` (
	`comment_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`comment_id`, `actor_id`),
	FOREIGN KEY (`comment_id`) REFERENCES `ft_comments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ft_comments` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`work_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `ft_comments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ft_comments_id_unique` ON `ft_comments` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ft_comments_author_key` ON `ft_comments` (`author_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ft_comments_work_seq` ON `ft_comments` (`work_id`,`seq`);--> statement-breakpoint
CREATE INDEX `ft_comments_parent_seq` ON `ft_comments` (`parent_id`,`seq`);--> statement-breakpoint
CREATE INDEX `ft_comments_author_created` ON `ft_comments` (`author_id`,`created_at`);