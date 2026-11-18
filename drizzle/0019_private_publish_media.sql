-- Drafts never enter ft_works or any public discovery / game route.
CREATE TABLE ft_publish_drafts (
 id text PRIMARY KEY NOT NULL,
 owner_id text NOT NULL,
 source text NOT NULL,
 url text,
 content_hash text NOT NULL,
 game_key text,
 created_at text NOT NULL,
 expires_at text NOT NULL
);
CREATE INDEX ft_publish_drafts_owner ON ft_publish_drafts(owner_id,created_at);
CREATE TABLE ft_publish_captures (
 id text PRIMARY KEY NOT NULL,
 draft_id text NOT NULL REFERENCES ft_publish_drafts(id),
 kind text NOT NULL,
 status text NOT NULL,
 wait_ms integer NOT NULL,
 reserved_seconds integer NOT NULL,
 lease_until text NOT NULL,
 object_key text,
 byte_size integer,
 duration_ms integer,
 reason text,
 elapsed_ms integer,
 created_at text NOT NULL
);
CREATE INDEX ft_publish_captures_draft ON ft_publish_captures(draft_id,kind,created_at);
CREATE INDEX ft_publish_captures_budget ON ft_publish_captures(kind,created_at);
