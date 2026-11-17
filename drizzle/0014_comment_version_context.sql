-- Keep historical/old-client comments unknown; never infer the current version.
-- Versions are immutable. This is page context, not a gameplay completion receipt.
ALTER TABLE ft_comments ADD COLUMN version_id text REFERENCES ft_work_versions(id);
