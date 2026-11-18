-- Derived preview media never changes a version, manual cover or card snapshot.
CREATE TABLE ft_video_preview_jobs (
  id text PRIMARY KEY NOT NULL,
  work_id text NOT NULL REFERENCES ft_works(id),
  version_id text NOT NULL REFERENCES ft_work_versions(id),
  owner_id text NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  lease_id text,
  lease_until text,
  reason text,
  object_key text,
  byte_size integer,
  duration_ms integer,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_video_preview_work_version ON ft_video_preview_jobs(work_id,version_id);
--> statement-breakpoint
CREATE INDEX ft_video_preview_queue ON ft_video_preview_jobs(status,created_at);
--> statement-breakpoint
CREATE TABLE ft_video_preview_attempts (
  id text PRIMARY KEY NOT NULL,
  job_id text NOT NULL REFERENCES ft_video_preview_jobs(id),
  reserved_seconds integer NOT NULL,
  elapsed_ms integer,
  outcome text,
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX ft_video_preview_budget_time ON ft_video_preview_attempts(created_at);
