DROP INDEX `ft_works_owner_created`;--> statement-breakpoint
CREATE INDEX `ft_works_created_id` ON `ft_works` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ft_works_source_created` ON `ft_works` (`source`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ft_works_owner_created` ON `ft_works` (`author_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ft_comments_work_created` ON `ft_comments` (`work_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ft_work_likes_work_created` ON `ft_work_likes` (`work_id`,`created_at`);