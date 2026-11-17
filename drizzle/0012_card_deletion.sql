-- Keep immutable snapshots and historical event references; revoke reads with a tombstone.
ALTER TABLE ft_cards ADD COLUMN deleted_at text;
