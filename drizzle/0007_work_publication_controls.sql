CREATE TABLE `ft_work_discovery` (
	`work_id` text PRIMARY KEY NOT NULL,
	`visibility` text DEFAULT 'unlisted' NOT NULL,
	`review_status` text DEFAULT 'unsubmitted' NOT NULL,
	`kind` text DEFAULT 'unspecified' NOT NULL,
	`play_description` text DEFAULT '' NOT NULL,
	`submitted_version_id` text,
	`approved_version_id` text,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ft_work_discovery_review` ON `ft_work_discovery` (`review_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ft_work_discovery_visibility` ON `ft_work_discovery` (`visibility`,`review_status`);--> statement-breakpoint
CREATE TABLE `ft_work_fingerprints` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`work_id` text NOT NULL,
	`version_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`, `fingerprint`),
	FOREIGN KEY (`work_id`) REFERENCES `ft_works`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `ft_work_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ft_work_fingerprints_work` ON `ft_work_fingerprints` (`work_id`);
--> statement-breakpoint
-- Grandfather existing discovery only. Do not edit works, versions or cards,
-- and do not invent a reviewer identity for this compatibility backfill.
INSERT INTO ft_work_discovery(work_id,visibility,review_status,submitted_version_id,approved_version_id,review_note,updated_at)
SELECT id,'listed','approved',current_version_id,current_version_id,'历史作品保留展示',COALESCE(NULLIF(updated_at,''),created_at) FROM ft_works;
--> statement-breakpoint
INSERT INTO ft_work_fingerprints(owner_id,kind,fingerprint,work_id,version_id,created_at)
SELECT author_id,'html',content_hash,work_id,version_id,created_at FROM (
  SELECT w.author_id,v.content_hash,w.id work_id,v.id version_id,v.created_at,
    ROW_NUMBER() OVER(PARTITION BY w.author_id,v.content_hash ORDER BY w.created_at,w.id,v.ordinal) chosen
  FROM ft_works w JOIN ft_work_versions v ON v.work_id=w.id WHERE w.source='html' AND v.content_hash IS NOT NULL AND v.content_hash<>''
) WHERE chosen=1;
--> statement-breakpoint
INSERT INTO ft_work_fingerprints(owner_id,kind,fingerprint,work_id,version_id,created_at)
SELECT author_id,'url',url,id,current_version_id,created_at FROM (
  SELECT w.*,ROW_NUMBER() OVER(PARTITION BY w.author_id,w.url ORDER BY w.created_at,w.id) chosen
  FROM ft_works w WHERE w.source='url' AND w.url IS NOT NULL
) WHERE chosen=1;
--> statement-breakpoint
-- Keep the rolling-deploy interval safe: old code can still create a work, but
-- that work does not automatically enter discovery and always has a state row.
CREATE TRIGGER ft_discovery_new_work AFTER INSERT ON ft_works BEGIN
  INSERT INTO ft_work_discovery(work_id,updated_at) VALUES(NEW.id,NEW.created_at);
END;
--> statement-breakpoint
-- Approval concerns exactly the submitted content. Replacing a version or
-- editing its visible metadata atomically invalidates an old review, including
-- concurrent approvals. Hide/restore and profile-name edits do not touch it.
CREATE TRIGGER ft_discovery_recheck AFTER UPDATE OF current_version_id,current_metadata_id,name,description ON ft_works
WHEN OLD.current_version_id IS NOT NEW.current_version_id OR OLD.current_metadata_id IS NOT NEW.current_metadata_id
  OR OLD.name IS NOT NEW.name OR OLD.description IS NOT NEW.description
BEGIN
  UPDATE ft_work_discovery SET
    review_status=CASE WHEN review_status='unsubmitted' THEN 'unsubmitted' ELSE 'pending' END,
    submitted_version_id=CASE WHEN review_status='unsubmitted' THEN NULL ELSE NEW.current_version_id END,
    approved_version_id=NULL,review_note='',reviewed_by=NULL,revision=revision+1,updated_at=NEW.updated_at
  WHERE work_id=NEW.id;
END;
