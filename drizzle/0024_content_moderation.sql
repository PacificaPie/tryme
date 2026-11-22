-- Append-only decisions: restoration never deletes artifacts or rewrites cards.
CREATE TABLE ft_moderation_actions (
  seq integer PRIMARY KEY AUTOINCREMENT,
  target_type text NOT NULL CHECK(target_type IN ('work','card')),
  target_id text NOT NULL,
  revision integer NOT NULL CHECK(revision > 0),
  action text NOT NULL CHECK(action IN ('block','restore')),
  actor_id text NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_moderation_target_revision ON ft_moderation_actions(target_type,target_id,revision);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_moderation_actor_key ON ft_moderation_actions(actor_id,idempotency_key);
--> statement-breakpoint
CREATE VIEW ft_content_restrictions AS
SELECT a.target_type,a.target_id FROM ft_moderation_actions a
WHERE a.action='block' AND a.revision=(SELECT MAX(latest.revision) FROM ft_moderation_actions latest
  WHERE latest.target_type=a.target_type AND latest.target_id=a.target_id);
--> statement-breakpoint
CREATE TRIGGER ft_moderation_no_update BEFORE UPDATE ON ft_moderation_actions
BEGIN SELECT RAISE(ABORT,'MODERATION_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER ft_moderation_no_delete BEFORE DELETE ON ft_moderation_actions
BEGIN SELECT RAISE(ABORT,'MODERATION_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
-- Close a preview/save race even when a request began before the takedown.
CREATE TRIGGER ft_card_restricted_work_selection BEFORE INSERT ON ft_cards
WHEN EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json,'$.works') saved
  JOIN ft_content_restrictions r ON r.target_type='work' AND r.target_id=json_extract(saved.value,'$.id'))
BEGIN SELECT RAISE(ABORT,'CONTENT_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TRIGGER ft_restricted_work_version BEFORE INSERT ON ft_work_versions
WHEN EXISTS(SELECT 1 FROM ft_content_restrictions WHERE target_type='work' AND target_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'CONTENT_UNAVAILABLE'); END;
--> statement-breakpoint
CREATE TRIGGER ft_restricted_work_metadata BEFORE INSERT ON ft_work_metadata
WHEN EXISTS(SELECT 1 FROM ft_content_restrictions WHERE target_type='work' AND target_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'CONTENT_UNAVAILABLE'); END;
