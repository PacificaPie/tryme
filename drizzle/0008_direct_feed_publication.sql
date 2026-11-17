-- Remove the manual review gate without rewriting any existing visibility,
-- review history, work, version, card or event. Author-hidden works stay hidden.
DROP TRIGGER IF EXISTS ft_discovery_recheck;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ft_discovery_new_work;
--> statement-breakpoint
-- Explicit listed publication works across the deploy interval, including old
-- publishers. The table's unlisted default remains a fail-closed fallback for
-- unrelated inserts; new publish transactions also specify listed in code.
CREATE TRIGGER ft_discovery_new_work AFTER INSERT ON ft_works BEGIN
  INSERT INTO ft_work_discovery(work_id,visibility,updated_at)
    VALUES(NEW.id,'listed',NEW.created_at);
END;
