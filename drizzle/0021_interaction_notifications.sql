-- 0019/0020 are reserved by the independent publishing and WeChat branches.
-- No backfill: only successful source inserts after this migration notify.
-- Source mutations and notification creation/retraction share one transaction.
CREATE TABLE ft_notifications (
  seq integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  recipient_id text NOT NULL,
  actor_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('work_like','comment_like','comment','reply','follow')),
  target_id text NOT NULL,
  work_id text,
  created_at text NOT NULL,
  read_at text,
  active integer NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  CHECK (recipient_id <> actor_id)
);
-- Source IDs deliberately have no cascading FK: a missing source becomes a
-- content-unavailable tombstone. Bodies/names are read live, never copied here.
CREATE UNIQUE INDEX ft_notifications_event ON ft_notifications(recipient_id,kind,actor_id,target_id);
CREATE INDEX ft_notifications_inbox ON ft_notifications(recipient_id,active,seq);
CREATE INDEX ft_notifications_unread ON ft_notifications(recipient_id,active,read_at,seq);
CREATE INDEX ft_notifications_group ON ft_notifications(recipient_id,kind,target_id,seq);

CREATE TRIGGER ft_notify_work_like AFTER INSERT ON ft_work_likes BEGIN
  INSERT OR IGNORE INTO ft_notifications(recipient_id,actor_id,kind,target_id,work_id,created_at)
    SELECT author_id,NEW.actor_id,'work_like',NEW.work_id,NEW.work_id,NEW.created_at
    FROM ft_works WHERE id=NEW.work_id AND author_id<>NEW.actor_id;
  UPDATE ft_notifications SET active=1
    WHERE kind='work_like' AND target_id=NEW.work_id AND actor_id=NEW.actor_id;
END;
CREATE TRIGGER ft_retract_work_like AFTER DELETE ON ft_work_likes BEGIN
  UPDATE ft_notifications SET active=0,read_at=COALESCE(read_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE kind='work_like' AND target_id=OLD.work_id AND actor_id=OLD.actor_id;
END;

CREATE TRIGGER ft_notify_comment_like AFTER INSERT ON ft_comment_likes BEGIN
  INSERT OR IGNORE INTO ft_notifications(recipient_id,actor_id,kind,target_id,work_id,created_at)
    SELECT author_id,NEW.actor_id,'comment_like',id,work_id,NEW.created_at
    FROM ft_comments WHERE id=NEW.comment_id AND author_id<>NEW.actor_id;
  UPDATE ft_notifications SET active=1
    WHERE kind='comment_like' AND target_id=NEW.comment_id AND actor_id=NEW.actor_id;
END;
CREATE TRIGGER ft_retract_comment_like AFTER DELETE ON ft_comment_likes BEGIN
  UPDATE ft_notifications SET active=0,read_at=COALESCE(read_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE kind='comment_like' AND target_id=OLD.comment_id AND actor_id=OLD.actor_id;
END;

CREATE TRIGGER ft_notify_comment AFTER INSERT ON ft_comments BEGIN
  -- A direct reply reaches the root-comment author, including on another work.
  INSERT OR IGNORE INTO ft_notifications(recipient_id,actor_id,kind,target_id,work_id,created_at)
    SELECT p.author_id,NEW.author_id,'reply',NEW.id,NEW.work_id,NEW.created_at
    FROM ft_comments p WHERE p.id=NEW.parent_id AND p.author_id<>NEW.author_id;
  -- Also inform the work owner, but never twice when they own the root comment.
  INSERT OR IGNORE INTO ft_notifications(recipient_id,actor_id,kind,target_id,work_id,created_at)
    SELECT w.author_id,NEW.author_id,'comment',NEW.id,NEW.work_id,NEW.created_at
    FROM ft_works w WHERE w.id=NEW.work_id AND w.author_id<>NEW.author_id
      AND NOT EXISTS (SELECT 1 FROM ft_comments p WHERE p.id=NEW.parent_id AND p.author_id=w.author_id);
END;

CREATE TRIGGER ft_notify_follow AFTER INSERT ON ft_creator_follows BEGIN
  INSERT OR IGNORE INTO ft_notifications(recipient_id,actor_id,kind,target_id,created_at)
    SELECT NEW.creator_id,NEW.follower_id,'follow',NEW.creator_id,NEW.created_at
    WHERE NEW.creator_id<>NEW.follower_id;
  UPDATE ft_notifications SET active=1
    WHERE kind='follow' AND recipient_id=NEW.creator_id AND actor_id=NEW.follower_id;
END;
CREATE TRIGGER ft_retract_follow AFTER DELETE ON ft_creator_follows BEGIN
  UPDATE ft_notifications SET active=0,read_at=COALESCE(read_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    WHERE kind='follow' AND recipient_id=OLD.creator_id AND actor_id=OLD.follower_id;
END;
