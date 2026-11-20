-- Link sharing is not Feed consent. Existing and newly saved cards stay unlisted.
-- Append-only selections give each traversal a stable high-water mark. A NULL
-- card_id withdraws the author's selection; a deleted card never revives an older one.
CREATE TABLE ft_card_feed_selections (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id TEXT NOT NULL,
  card_id TEXT REFERENCES ft_cards(id),
  created_at TEXT NOT NULL
);
CREATE INDEX ft_card_feed_author_seq ON ft_card_feed_selections(author_id, seq);
CREATE INDEX ft_card_feed_card ON ft_card_feed_selections(card_id);
