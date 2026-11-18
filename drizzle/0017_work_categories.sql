-- Category describes the work, never the upload/hosting mechanism.
-- Unclassified legacy works stay discoverable under Other and All.
ALTER TABLE ft_work_discovery ADD COLUMN category text NOT NULL DEFAULT 'other'
  CHECK (category IN ('website','game','other'));
--> statement-breakpoint
UPDATE ft_work_discovery SET category='game' WHERE kind='game';
--> statement-breakpoint
CREATE INDEX ft_work_discovery_category ON ft_work_discovery(category,visibility);
