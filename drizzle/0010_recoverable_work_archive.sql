-- Lifecycle is separate from public Feed visibility. All existing works remain
-- active; no work, version, card, event, fingerprint or stored object is removed.
ALTER TABLE ft_works ADD COLUMN archived_at text;
--> statement-breakpoint
CREATE INDEX ft_works_owner_archived_created ON ft_works(author_id,archived_at,created_at,id);
--> statement-breakpoint
-- A lifecycle transition invalidates stale visibility forms in the same SQL
-- transaction. Restoring to the studio deliberately does not republish to Feed.
CREATE TRIGGER ft_work_archive_visibility AFTER UPDATE OF archived_at ON ft_works
WHEN OLD.archived_at IS NOT NEW.archived_at
BEGIN
  UPDATE ft_work_discovery SET visibility='unlisted',revision=revision+1,updated_at=NEW.updated_at
  WHERE work_id=NEW.id;
END;
--> statement-breakpoint
-- Enforce the invariant for concurrent requests and clients from older deploys.
CREATE TRIGGER ft_archived_work_cannot_list BEFORE UPDATE OF visibility ON ft_work_discovery
WHEN NEW.visibility='listed' AND EXISTS(SELECT 1 FROM ft_works WHERE id=NEW.work_id AND archived_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'WORK_ARCHIVED');
END;
--> statement-breakpoint
CREATE TRIGGER ft_archived_work_cannot_list_insert BEFORE INSERT ON ft_work_discovery
WHEN NEW.visibility='listed' AND EXISTS(SELECT 1 FROM ft_works WHERE id=NEW.work_id AND archived_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT,'WORK_ARCHIVED');
END;
--> statement-breakpoint
-- Existing immutable snapshots remain readable. A newly saved card must not
-- accidentally reselect a work archived after the preview was assembled.
CREATE TRIGGER ft_card_active_work_selection BEFORE INSERT ON ft_cards
WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.snapshot_json,'$.workIds') selected
  JOIN ft_works w ON w.id=selected.value WHERE w.archived_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT,'WORK_ARCHIVED');
END;
