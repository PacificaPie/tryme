-- Private, short-lived previews created before there is a published work.
-- Keep reservations for the monthly budget after the image expires.
CREATE TABLE ft_cover_drafts (
 id text PRIMARY KEY NOT NULL,
 owner_id text NOT NULL,
 url text NOT NULL,
 wait_ms integer NOT NULL,
 status text NOT NULL,
 object_key text,
 reason text,
 reserved_seconds integer NOT NULL,
 elapsed_ms integer,
 created_at text NOT NULL,
 expires_at text NOT NULL,
 lease_until text NOT NULL
);
--> statement-breakpoint
CREATE INDEX ft_cover_drafts_owner_url ON ft_cover_drafts(owner_id,url,created_at);
--> statement-breakpoint
CREATE INDEX ft_cover_drafts_budget ON ft_cover_drafts(created_at);
