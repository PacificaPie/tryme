-- WeChat is an additional credential for an existing verified Clerk subject.
-- It never creates a parallel platform identity or rewrites existing ownership.
CREATE TABLE ft_wechat_identities (
  app_id text NOT NULL,
  open_id text NOT NULL,
  clerk_user_id text NOT NULL,
  union_id text,
  created_at integer NOT NULL,
  PRIMARY KEY(app_id,open_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_wechat_identity_user ON ft_wechat_identities(app_id,clerk_user_id);
--> statement-breakpoint
-- UnionID is informational and scoped to this app; never an account merge key.
CREATE TABLE ft_wechat_flows (
  id text PRIMARY KEY NOT NULL,
  app_id text NOT NULL,
  state_hash text NOT NULL,
  browser_hash text NOT NULL,
  token_hash text,
  kind text NOT NULL,
  phase text NOT NULL,
  expected_user_id text,
  initiating_session_id text,
  mapped_user_id text,
  open_id text,
  union_id text,
  return_to text NOT NULL,
  created_at integer NOT NULL,
  expires_at integer NOT NULL,
  consumed_at integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_wechat_flow_state ON ft_wechat_flows(state_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX ft_wechat_flow_token ON ft_wechat_flows(token_hash);
--> statement-breakpoint
CREATE INDEX ft_wechat_flow_browser ON ft_wechat_flows(browser_hash,phase);
--> statement-breakpoint
CREATE INDEX ft_wechat_flow_expiry ON ft_wechat_flows(expires_at);
--> statement-breakpoint
CREATE TABLE ft_wechat_rate_windows (
  key_hash text PRIMARY KEY NOT NULL,
  count integer NOT NULL,
  expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX ft_wechat_rate_expiry ON ft_wechat_rate_windows(expires_at);
