-- Additive experiment data only. Existing works, versions, metadata, cards,
-- social interactions and analytics remain unchanged; no historical credits.
CREATE TABLE ft_feed_impressions (
  id TEXT PRIMARY KEY NOT NULL,
  client_event_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES ft_works(id),
  sort TEXT NOT NULL CHECK(sort IN ('recommended','newest','likes','comments')),
  exposure_day TEXT NOT NULL,
  received_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_feed_impressions_actor_client ON ft_feed_impressions(actor_id,client_event_id);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_feed_impressions_actor_work_day ON ft_feed_impressions(actor_id,work_id,exposure_day);
--> statement-breakpoint
CREATE INDEX ft_feed_impressions_work_received ON ft_feed_impressions(work_id,received_at,actor_id);
--> statement-breakpoint
CREATE INDEX ft_feed_impressions_actor_received ON ft_feed_impressions(actor_id,received_at);
--> statement-breakpoint
CREATE TABLE ft_contribution_credits (
  actor_id TEXT NOT NULL,
  target_work_id TEXT NOT NULL REFERENCES ft_works(id),
  target_author_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('like','comment','feedback')),
  source_id TEXT NOT NULL,
  earned_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_id,target_work_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_contribution_credits_actor_author_day ON ft_contribution_credits(actor_id,target_author_id,earned_day);
--> statement-breakpoint
CREATE INDEX ft_contribution_credits_actor_day ON ft_contribution_credits(actor_id,earned_day);
--> statement-breakpoint
CREATE INDEX ft_contribution_credits_actor_created ON ft_contribution_credits(actor_id,created_at);
--> statement-breakpoint
CREATE INDEX ft_events_play_work_received ON ft_events(work_id,received_at,actor_id) WHERE event_type='play_start';
--> statement-breakpoint
CREATE INDEX ft_events_play_actor_work_received ON ft_events(actor_id,work_id,received_at) WHERE event_type='play_start';
