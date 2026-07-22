-- Phase 2 keeps the existing cache_revision_read surface but replaces its
-- per-match MAX(revision) implementation with one durable global epoch.
-- Snapshot caches must never infer global freshness from a match-local row.
CREATE TABLE analytics.cache_epoch (
  singleton_id BOOLEAN PRIMARY KEY CHECK (singleton_id = true),
  revision BIGINT NOT NULL CHECK (revision > 0),
  invalidated_at TIMESTAMPTZ NOT NULL
);

INSERT INTO analytics.cache_epoch (singleton_id, revision, invalidated_at)
VALUES (true, 1, TIMESTAMPTZ '1970-01-01 00:00:00+00');

ALTER TABLE analytics.cache_epoch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analytics.cache_epoch FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE VIEW analytics.cache_revision_read AS
SELECT epoch.revision, epoch.invalidated_at
FROM analytics.cache_epoch epoch
WHERE epoch.singleton_id = true;

-- The function is only reachable from owner-run source-table triggers. It is
-- deliberately not granted to either runtime role or any Data API role.
CREATE OR REPLACE FUNCTION analytics.advance_cache_epoch()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE analytics.cache_epoch epoch
  SET revision = epoch.revision + 1,
      invalidated_at = CURRENT_TIMESTAMP
  WHERE epoch.singleton_id = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'analytics cache epoch singleton is missing';
  END IF;
END;
$$;

-- Keep the existing function identity for the catalog and legacy invalidation
-- contract. It now handles the global epoch as well as match-local receipts.
CREATE OR REPLACE FUNCTION analytics.queue_match_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_match_id TEXT;
  previous_match_id TEXT;
  new_is_eligible BOOLEAN := false;
  old_is_eligible BOOLEAN := false;
  source_relevant BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      new_is_eligible := NEW."status" = 'COMPLETED'::public."MatchStatus"
        AND NEW."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND NEW."isSimulation" = false;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      old_is_eligible := OLD."status" = 'COMPLETED'::public."MatchStatus"
        AND OLD."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND OLD."isSimulation" = false;
    END IF;

    IF new_is_eligible OR old_is_eligible THEN
      PERFORM analytics.advance_cache_epoch();

      -- A deleted Match is removed by the foreign key cascade from
      -- cache_invalidation, so only live rows receive a local receipt.
      IF TG_OP <> 'DELETE' THEN
        IF new_is_eligible THEN
          INSERT INTO analytics.cache_invalidation (
            match_id, competition_id, reason, revision, invalidated_at
          ) VALUES (
            NEW."id", NEW."competitionId", TG_ARGV[0], 1, CURRENT_TIMESTAMP
          )
          ON CONFLICT (match_id) DO UPDATE SET
            competition_id = EXCLUDED.competition_id,
            reason = EXCLUDED.reason,
            revision = analytics.cache_invalidation.revision + 1,
            invalidated_at = CURRENT_TIMESTAMP;
        ELSE
          INSERT INTO analytics.cache_invalidation (
            match_id, competition_id, reason, revision, invalidated_at
          ) VALUES (
            OLD."id", OLD."competitionId", TG_ARGV[0], 1, CURRENT_TIMESTAMP
          )
          ON CONFLICT (match_id) DO UPDATE SET
            competition_id = EXCLUDED.competition_id,
            reason = EXCLUDED.reason,
            revision = analytics.cache_invalidation.revision + 1,
            invalidated_at = CURRENT_TIMESTAMP;
        END IF;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME IN ('PlayerMatchStats', 'TeamMatchStats') THEN
    IF TG_OP = 'DELETE' THEN
      target_match_id := OLD."matchId";
    ELSE
      target_match_id := NEW."matchId";
      IF TG_OP = 'UPDATE' THEN previous_match_id := OLD."matchId"; END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public."Match" match
      WHERE match."id" IN (target_match_id, previous_match_id)
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
    ) THEN
      PERFORM analytics.advance_cache_epoch();
      INSERT INTO analytics.cache_invalidation (
        match_id, competition_id, reason, revision, invalidated_at
      )
      SELECT match."id", match."competitionId", TG_ARGV[0], 1, CURRENT_TIMESTAMP
      FROM public."Match" match
      WHERE match."id" IN (target_match_id, previous_match_id)
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
      ON CONFLICT (match_id) DO UPDATE SET
        competition_id = EXCLUDED.competition_id,
        reason = EXCLUDED.reason,
        revision = analytics.cache_invalidation.revision + 1,
        invalidated_at = CURRENT_TIMESTAMP;
    END IF;
  ELSIF TG_TABLE_NAME = 'DataCoverage' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
      SELECT 1
      FROM public."Match" match
      WHERE match."competitionId" = NEW."competitionId"
        AND (NEW."matchId" IS NULL OR match."id" = NEW."matchId")
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
    ) THEN
      source_relevant := true;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
      SELECT 1
      FROM public."Match" match
      WHERE match."competitionId" = OLD."competitionId"
        AND (OLD."matchId" IS NULL OR match."id" = OLD."matchId")
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
    ) THEN
      source_relevant := true;
    END IF;
    IF source_relevant THEN PERFORM analytics.advance_cache_epoch(); END IF;
  ELSIF TG_TABLE_NAME = 'ImportRun' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."competitionId" IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public."Match" match
      WHERE match."competitionId" = NEW."competitionId"
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
    ) THEN
      source_relevant := true;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."competitionId" IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public."Match" match
      WHERE match."competitionId" = OLD."competitionId"
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
    ) THEN
      source_relevant := true;
    END IF;
    IF source_relevant THEN PERFORM analytics.advance_cache_epoch(); END IF;
  ELSIF TG_TABLE_NAME = 'SourceSystem' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
      SELECT 1
      FROM public."ImportRun" import_run
      JOIN public."Match" match ON match."competitionId" = import_run."competitionId"
      WHERE import_run."sourceSystemId" = NEW."id"
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
    ) THEN
      source_relevant := true;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
      SELECT 1
      FROM public."ImportRun" import_run
      JOIN public."Match" match ON match."competitionId" = import_run."competitionId"
      WHERE import_run."sourceSystemId" = OLD."id"
        AND match."status" = 'COMPLETED'::public."MatchStatus"
        AND match."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND match."isSimulation" = false
    ) THEN
      source_relevant := true;
    END IF;
    IF source_relevant THEN PERFORM analytics.advance_cache_epoch(); END IF;
  ELSIF TG_TABLE_NAME = 'MatchSlot' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
      SELECT 1 FROM public."Match" match WHERE match."id" = NEW."matchId"
    ) THEN
      source_relevant := true;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
      SELECT 1 FROM public."Match" match WHERE match."id" = OLD."matchId"
    ) THEN
      source_relevant := true;
    END IF;
    IF source_relevant THEN PERFORM analytics.advance_cache_epoch(); END IF;
  ELSIF TG_TABLE_NAME IN (
    'CompetitionSeries',
    'Competition',
    'Stage',
    'StageGroup',
    'EditionEntry',
    'RosterMembership',
    'Player',
    'Team'
  ) THEN
    -- These tables are not hot event streams, and their mutations can change
    -- directory identity, publication gates, or scope semantics directly.
    PERFORM analytics.advance_cache_epoch();
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION analytics.advance_cache_epoch()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION analytics.queue_match_invalidation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.cache_revision_read
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS analytics_match_finalization_invalidation ON public."Match";
CREATE TRIGGER analytics_match_finalization_invalidation
AFTER INSERT OR UPDATE OF
  "competitionId", "status", "resultQuality", "isSimulation", "scheduledAt",
  "sourceUpdatedAt", "homeTeamId", "awayTeamId", "neutralVenue", "homeScore",
  "awayScore", "stageId", "stageGroupId", "updatedAt"
  OR DELETE
ON public."Match"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('MATCH_LIFECYCLE_CHANGED');

DROP TRIGGER IF EXISTS analytics_player_stats_invalidation ON public."PlayerMatchStats";
CREATE TRIGGER analytics_player_stats_invalidation
AFTER INSERT OR UPDATE OR DELETE
ON public."PlayerMatchStats"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('PLAYER_STATS_CHANGED');

DROP TRIGGER IF EXISTS analytics_team_stats_invalidation ON public."TeamMatchStats";
CREATE TRIGGER analytics_team_stats_invalidation
AFTER INSERT OR UPDATE OR DELETE
ON public."TeamMatchStats"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('TEAM_STATS_CHANGED');

CREATE TRIGGER analytics_competition_series_cache_invalidation
AFTER INSERT OR UPDATE OF "slug", "name", "kind" OR DELETE
ON public."CompetitionSeries"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('COMPETITION_SERIES_CHANGED');

CREATE TRIGGER analytics_competition_cache_invalidation
AFTER INSERT OR UPDATE OF
  "name", "season", "seasonStart", "seasonEnd", "seriesId", "slug", "label",
  "sourceTimezone", "publicationStatus", "publishedAt"
  OR DELETE
ON public."Competition"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('COMPETITION_CHANGED');

CREATE TRIGGER analytics_stage_cache_invalidation
AFTER INSERT OR UPDATE OF
  "competitionId", "slug", "name", "type", "sequence", "isPublished"
  OR DELETE
ON public."Stage"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('STAGE_CHANGED');

CREATE TRIGGER analytics_stage_group_cache_invalidation
AFTER INSERT OR UPDATE OF "stageId", "slug", "name", "sequence" OR DELETE
ON public."StageGroup"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('STAGE_GROUP_CHANGED');

CREATE TRIGGER analytics_edition_entry_cache_invalidation
AFTER INSERT OR UPDATE OF
  "competitionId", "teamId", "primaryGroupId", "status", "displayName"
  OR DELETE
ON public."EditionEntry"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('EDITION_ENTRY_CHANGED');

CREATE TRIGGER analytics_roster_membership_cache_invalidation
AFTER INSERT OR UPDATE OF
  "editionEntryId", "playerId", "status", "validFrom", "validTo", "designatedPosition"
  OR DELETE
ON public."RosterMembership"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('ROSTER_MEMBERSHIP_CHANGED');

CREATE TRIGGER analytics_player_cache_invalidation
AFTER INSERT OR UPDATE OF "name", "position", "teamId" OR DELETE
ON public."Player"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('PLAYER_DIRECTORY_CHANGED');

CREATE TRIGGER analytics_team_cache_invalidation
AFTER INSERT OR UPDATE OF "name", "slug", "abbreviation", "competitionId" OR DELETE
ON public."Team"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('TEAM_DIRECTORY_CHANGED');

CREATE TRIGGER analytics_data_coverage_cache_invalidation
AFTER INSERT OR UPDATE OF "competitionId", "matchId", "capability", "state" OR DELETE
ON public."DataCoverage"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('DATA_COVERAGE_CHANGED');

CREATE TRIGGER analytics_import_run_cache_invalidation
AFTER INSERT OR UPDATE OF "sourceSystemId", "competitionId", "status", "dryRun", "issueCount" OR DELETE
ON public."ImportRun"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('IMPORT_READINESS_CHANGED');

CREATE TRIGGER analytics_source_system_cache_invalidation
AFTER INSERT OR UPDATE OF "key" OR DELETE
ON public."SourceSystem"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('SOURCE_SYSTEM_CHANGED');

CREATE TRIGGER analytics_match_slot_cache_invalidation
AFTER INSERT OR UPDATE OF "matchId" OR DELETE
ON public."MatchSlot"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('MATCH_SLOT_CHANGED');

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM PUBLIC, anon, authenticated, service_role;
