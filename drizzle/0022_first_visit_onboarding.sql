-- Preference is not an authorization role. Existing accounts are not enrolled.
CREATE TABLE ft_onboarding_rollout (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at INTEGER NOT NULL
);
INSERT INTO ft_onboarding_rollout (id, started_at) VALUES (1, unixepoch() * 1000);
CREATE TABLE ft_onboarding (
  owner_id TEXT PRIMARY KEY,
  intent TEXT NOT NULL CHECK (intent IN ('discover', 'create')),
  creator_started_at TEXT,
  completed_at TEXT NOT NULL
);
