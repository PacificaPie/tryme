-- Profiles are stable account identities; cards remain immutable presentation snapshots.
ALTER TABLE ft_profiles ADD COLUMN avatar_url text NOT NULL DEFAULT '';
CREATE TABLE ft_creator_follows (
  follower_id text NOT NULL,
  creator_id text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY (follower_id, creator_id),
  CONSTRAINT ft_creator_follows_not_self CHECK (follower_id <> creator_id)
);
CREATE INDEX ft_creator_follows_creator ON ft_creator_follows(creator_id, created_at, follower_id);
CREATE INDEX ft_creator_follows_follower ON ft_creator_follows(follower_id, created_at, creator_id);
-- Uploaded images are immutable so changing an account avatar cannot alter an old card.
CREATE TABLE ft_profile_avatars (
  id text PRIMARY KEY NOT NULL,
  owner_id text NOT NULL,
  object_key text NOT NULL,
  mime text NOT NULL,
  byte_size integer NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX ft_profile_avatars_owner ON ft_profile_avatars(owner_id, created_at);
