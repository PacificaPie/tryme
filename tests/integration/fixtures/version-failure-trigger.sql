-- Local D1 integration fixture only. Apply after platform migrations and before
-- starting the single local Worker. Never apply to production.
-- A rejected statement inside D1 batch must roll back inserted version/operation
-- rows as well as the pointer update. Only the dedicated test payload triggers it.
CREATE TRIGGER IF NOT EXISTS ft_test_reject_version_commit
AFTER UPDATE OF current_version_id ON ft_works
WHEN OLD.author_id GLOB 'versions_owner_*'
  AND EXISTS (SELECT 1 FROM ft_work_versions v
    WHERE v.id = NEW.current_version_id
      AND v.release_notes = 'fixture: reject D1 version commit')
BEGIN
  SELECT RAISE(ABORT, 'Injected local version commit failure');
END;
