-- Automatic covers are optional jobs, never part of the publication commit.
-- Versions, existing metadata and card snapshots remain immutable.
CREATE TABLE ft_auto_cover_jobs (
  id text PRIMARY KEY NOT NULL,
  work_id text NOT NULL REFERENCES ft_works(id),
  version_id text NOT NULL REFERENCES ft_work_versions(id),
  owner_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  lease_id text,
  lease_until text,
  reason text,
  metadata_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_auto_cover_work_version ON ft_auto_cover_jobs(work_id,version_id);
--> statement-breakpoint
CREATE INDEX ft_auto_cover_queue ON ft_auto_cover_jobs(status,created_at);
--> statement-breakpoint
-- Reservations are deliberately not refunded: interrupted browser sessions
-- may remain billable until the provider's idle timeout closes them.
CREATE TABLE ft_auto_cover_attempts (
  id text PRIMARY KEY NOT NULL,
  job_id text NOT NULL REFERENCES ft_auto_cover_jobs(id),
  reserved_seconds integer NOT NULL,
  elapsed_ms integer,
  outcome text,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX ft_auto_cover_budget_time ON ft_auto_cover_attempts(created_at);
