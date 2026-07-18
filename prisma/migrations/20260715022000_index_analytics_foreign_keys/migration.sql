-- Cover every analytics foreign key so deletes/corrections do not require
-- unindexed scans as ranking and record history grows.
CREATE INDEX cache_invalidation_competition_idx
  ON analytics.cache_invalidation (competition_id);
CREATE INDEX record_entry_competition_idx
  ON analytics.record_entry (competition_id);
CREATE INDEX record_entry_supporting_match_idx
  ON analytics.record_entry (supporting_match_id);
CREATE INDEX record_entry_supporting_competition_idx
  ON analytics.record_entry (supporting_competition_id);
CREATE INDEX record_entry_supersedes_idx
  ON analytics.record_entry (supersedes_id);
