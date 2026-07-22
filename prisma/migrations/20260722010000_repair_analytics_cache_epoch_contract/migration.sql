-- Forward-only repair for the contract drift introduced after the historical
-- 20260722000000_add_analytics_cache_epoch migration was applied.
-- Keep this migration transactional under Prisma and limit the repair to the
-- epoch read contract, queue function, and Match lifecycle trigger.

CREATE OR REPLACE VIEW analytics.cache_revision_read AS
SELECT
  epoch.revision,
  epoch.invalidated_at,
  'analytics-cache-epoch.v1'::TEXT AS contract_version
FROM analytics.cache_epoch epoch
WHERE epoch.singleton_id = true;

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
  new_is_glasgow BOOLEAN := false;
  old_is_glasgow BOOLEAN := false;
  match_behavior_changed BOOLEAN := false;
  glasgow_structural_changed BOOLEAN := false;
  source_relevant BOOLEAN := false;
  new_coverage_relevant BOOLEAN := false;
  old_coverage_relevant BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      new_is_eligible := COALESCE(NEW."status" = 'COMPLETED'::public."MatchStatus"
        AND NEW."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND NEW."isSimulation" = false, false);
      new_is_glasgow := EXISTS (
        SELECT 1
        FROM public."Competition" competition
        JOIN public."CompetitionSeries" series ON series."id" = competition."seriesId"
        WHERE competition."id" = NEW."competitionId"
          AND competition."slug" = 'glasgow-2026'
          AND series."slug" = 'commonwealth-games-netball'
      );
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      old_is_eligible := COALESCE(OLD."status" = 'COMPLETED'::public."MatchStatus"
        AND OLD."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND OLD."isSimulation" = false, false);
      old_is_glasgow := EXISTS (
        SELECT 1
        FROM public."Competition" competition
        JOIN public."CompetitionSeries" series ON series."id" = competition."seriesId"
        WHERE competition."id" = OLD."competitionId"
          AND competition."slug" = 'glasgow-2026'
          AND series."slug" = 'commonwealth-games-netball'
      );
    END IF;

    IF TG_OP IN ('INSERT', 'DELETE') THEN
      match_behavior_changed := true;
      glasgow_structural_changed := new_is_glasgow OR old_is_glasgow;
    ELSE
      match_behavior_changed := NEW."competitionId" IS DISTINCT FROM OLD."competitionId"
        OR NEW."status" IS DISTINCT FROM OLD."status"
        OR NEW."resultQuality" IS DISTINCT FROM OLD."resultQuality"
        OR NEW."isSimulation" IS DISTINCT FROM OLD."isSimulation"
        OR NEW."scheduledAt" IS DISTINCT FROM OLD."scheduledAt"
        OR NEW."sourceUpdatedAt" IS DISTINCT FROM OLD."sourceUpdatedAt"
        OR NEW."homeTeamId" IS DISTINCT FROM OLD."homeTeamId"
        OR NEW."awayTeamId" IS DISTINCT FROM OLD."awayTeamId"
        OR NEW."neutralVenue" IS DISTINCT FROM OLD."neutralVenue"
        OR NEW."homeScore" IS DISTINCT FROM OLD."homeScore"
        OR NEW."awayScore" IS DISTINCT FROM OLD."awayScore"
        OR NEW."stageId" IS DISTINCT FROM OLD."stageId"
        OR NEW."stageGroupId" IS DISTINCT FROM OLD."stageGroupId";
      glasgow_structural_changed := (
        NEW."competitionId" IS DISTINCT FROM OLD."competitionId"
        OR NEW."stageId" IS DISTINCT FROM OLD."stageId"
      ) AND (new_is_glasgow OR old_is_glasgow);
    END IF;

    IF glasgow_structural_changed OR ((new_is_eligible OR old_is_eligible) AND match_behavior_changed) THEN
      PERFORM analytics.advance_cache_epoch();

      -- A deleted Match is removed by the foreign key cascade from
      -- cache_invalidation, so only live rows receive a local receipt.
      IF TG_OP <> 'DELETE' AND new_is_eligible THEN
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
      ELSIF TG_OP = 'UPDATE' AND old_is_eligible THEN
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
  ELSIF TG_TABLE_NAME IN ('PlayerMatchStats', 'TeamMatchStats') THEN
    IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;

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
    IF TG_OP = 'UPDATE'
      AND NEW."competitionId" IS NOT DISTINCT FROM OLD."competitionId"
      AND NEW."matchId" IS NOT DISTINCT FROM OLD."matchId"
      AND NEW."capability" IS NOT DISTINCT FROM OLD."capability"
      AND NEW."state" IS NOT DISTINCT FROM OLD."state" THEN
      RETURN NEW;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE')
      AND NEW."capability" IN (
        'PLAYER_BOX_SCORE'::public."DataCapability",
        'TEAM_BOX_SCORE'::public."DataCapability",
        'NET_POINTS'::public."DataCapability",
        'SUPER_SHOTS'::public."DataCapability"
      )
      AND EXISTS (
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
      new_coverage_relevant := true;
      source_relevant := true;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE')
      AND OLD."capability" IN (
        'PLAYER_BOX_SCORE'::public."DataCapability",
        'TEAM_BOX_SCORE'::public."DataCapability",
        'NET_POINTS'::public."DataCapability",
        'SUPER_SHOTS'::public."DataCapability"
      )
      AND EXISTS (
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
      old_coverage_relevant := true;
      source_relevant := true;
    END IF;
    IF new_coverage_relevant OR old_coverage_relevant OR source_relevant THEN
      PERFORM analytics.advance_cache_epoch();
    END IF;
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
  "awayScore", "stageId", "stageGroupId"
  OR DELETE
ON public."Match"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('MATCH_LIFECYCLE_CHANGED');
