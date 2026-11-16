CREATE TABLE `ft_work_likes` (
	`work_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`work_id`, `actor_id`),
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `ft_profiles` ADD `signature` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ft_profiles` ADD `headline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ft_profiles` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ft_profiles` ADD `back_style` text DEFAULT 'ink' NOT NULL;