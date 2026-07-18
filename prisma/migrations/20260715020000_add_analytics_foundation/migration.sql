-- CP-04 owns the private analytics surface. It is intentionally absent from
-- Supabase's exposed schemas and is never granted to Data API roles.
CREATE SCHEMA IF NOT EXISTS analytics;
COMMENT ON SCHEMA analytics IS
  'Private CentrePass analytics facts, summaries, persistence contracts, and invalidation state.';

REVOKE ALL ON SCHEMA analytics FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Leaf analytics features share these persistence contracts and must not add
-- independent migrations for rankings, records, or query telemetry.
CREATE TABLE analytics.ranking_snapshot (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ranking_type TEXT NOT NULL,
  method_version TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('PLAYER', 'TEAM')),
  entity_id TEXT NOT NULL,
  competition_id TEXT NOT NULL REFERENCES public."Competition"("id") ON DELETE CASCADE,
  scope_key TEXT NOT NULL,
  scope JSONB NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  rating DOUBLE PRECISION NOT NULL,
  percentile DOUBLE PRECISION CHECK (percentile BETWEEN 0 AND 100),
  games INTEGER NOT NULL CHECK (games >= 0),
  minutes DOUBLE PRECISION NOT NULL CHECK (minutes >= 0),
  coverage_state TEXT NOT NULL CHECK (coverage_state IN ('AVAILABLE', 'PARTIAL')),
  formula_version TEXT NOT NULL,
  included_match_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (ranking_type, method_version, entity_type, entity_id, competition_id, scope_key, as_of)
);

CREATE INDEX ranking_snapshot_lookup_idx
  ON analytics.ranking_snapshot (competition_id, ranking_type, scope_key, as_of DESC, rank);
CREATE INDEX ranking_snapshot_entity_idx
  ON analytics.ranking_snapshot (entity_type, entity_id, as_of DESC);

CREATE TABLE analytics.record_entry (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_type TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('PLAYER', 'TEAM')),
  entity_id TEXT NOT NULL,
  competition_id TEXT REFERENCES public."Competition"("id") ON DELETE CASCADE,
  scope_key TEXT NOT NULL,
  scope JSONB NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL,
  supporting_match_id TEXT REFERENCES public."Match"("id") ON DELETE SET NULL,
  supporting_competition_id TEXT REFERENCES public."Competition"("id") ON DELETE SET NULL,
  formula_version TEXT NOT NULL,
  coverage_state TEXT NOT NULL CHECK (coverage_state IN ('AVAILABLE', 'PARTIAL')),
  coverage_label TEXT NOT NULL,
  source JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL CHECK (status IN ('PROVISIONAL', 'CONFIRMED', 'SUPERSEDED', 'CORRECTED')),
  supersedes_id BIGINT REFERENCES analytics.record_entry(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX record_entry_lookup_idx
  ON analytics.record_entry (record_type, metric_id, scope_key, status, value DESC);
CREATE INDEX record_entry_entity_idx
  ON analytics.record_entry (entity_type, entity_id, achieved_at DESC);

CREATE TABLE analytics.query_telemetry (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_hash TEXT NOT NULL,
  query_spec JSONB,
  parser_version TEXT NOT NULL,
  result_status TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN analytics.query_telemetry.question_hash IS
  'One-way hash only. Raw natural-language questions are not stored in this contract.';
CREATE INDEX query_telemetry_created_idx ON analytics.query_telemetry (created_at DESC);
CREATE INDEX query_telemetry_parser_status_idx
  ON analytics.query_telemetry (parser_version, result_status, created_at DESC);

CREATE TABLE analytics.cache_invalidation (
  match_id TEXT PRIMARY KEY REFERENCES public."Match"("id") ON DELETE CASCADE,
  competition_id TEXT NOT NULL REFERENCES public."Competition"("id") ON DELETE CASCADE,
  reason TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX cache_invalidation_revision_idx
  ON analytics.cache_invalidation (revision, invalidated_at, match_id);

ALTER TABLE analytics.ranking_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.record_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.query_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.cache_invalidation ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM PUBLIC, anon, authenticated;

-- A match-specific coverage declaration takes precedence over the edition
-- declaration. Missing declarations fail closed as UNAVAILABLE.
CREATE VIEW analytics.match_capability_coverage
WITH (security_barrier = true)
AS
SELECT
  m."id" AS match_id,
  m."competitionId" AS competition_id,
  capability.capability,
  COALESCE(match_coverage."state", edition_coverage."state", 'UNAVAILABLE'::public."CoverageState") AS coverage_state,
  CASE
    WHEN match_coverage."state" IS NOT NULL THEN 'MATCH'
    WHEN edition_coverage."state" IS NOT NULL THEN 'EDITION'
    ELSE 'MISSING'
  END AS coverage_scope
FROM public."Match" m
CROSS JOIN (
  VALUES
    ('FINAL_SCORE'::public."DataCapability"),
    ('PERIOD_SCORES'::public."DataCapability"),
    ('TEAM_BOX_SCORE'::public."DataCapability"),
    ('PLAYER_BOX_SCORE'::public."DataCapability"),
    ('SCORE_FLOW'::public."DataCapability"),
    ('MATCH_EVENTS'::public."DataCapability"),
    ('SUBSTITUTIONS'::public."DataCapability"),
    ('NET_POINTS'::public."DataCapability"),
    ('SUPER_SHOTS'::public."DataCapability"),
    ('LINEUPS'::public."DataCapability")
) AS capability(capability)
LEFT JOIN LATERAL (
  SELECT dc."state"
  FROM public."DataCoverage" dc
  WHERE dc."competitionId" = m."competitionId"
    AND dc."matchId" = m."id"
    AND dc."capability" = capability.capability
  LIMIT 1
) match_coverage ON true
LEFT JOIN LATERAL (
  SELECT dc."state"
  FROM public."DataCoverage" dc
  WHERE dc."competitionId" = m."competitionId"
    AND dc."matchId" IS NULL
    AND dc."capability" = capability.capability
  LIMIT 1
) edition_coverage ON true;

-- This view is the only source of match lifecycle eligibility for downstream
-- facts: completed, official/corrected, and never simulated.
CREATE VIEW analytics.eligible_match
WITH (security_barrier = true)
AS
SELECT
  m."id" AS match_id,
  m."competitionId" AS competition_id,
  c."seriesId" AS competition_series_id,
  cs."kind"::TEXT AS competition_kind,
  m."stageId" AS stage_id,
  m."stageGroupId" AS stage_group_id,
  m."scheduledAt" AS scheduled_at,
  m."sourceUpdatedAt" AS source_updated_at,
  m."homeTeamId" AS home_team_id,
  m."awayTeamId" AS away_team_id
FROM public."Match" m
JOIN public."Competition" c ON c."id" = m."competitionId"
JOIN public."CompetitionSeries" cs ON cs."id" = c."seriesId"
WHERE m."status" = 'COMPLETED'::public."MatchStatus"
  AND m."resultQuality" IN (
    'OFFICIAL_FINAL'::public."ResultQualityStatus",
    'CORRECTED'::public."ResultQualityStatus"
  )
  AND m."isSimulation" = false;

CREATE VIEW analytics.player_match_fact
WITH (security_barrier = true)
AS
SELECT
  em.match_id,
  em.competition_id,
  em.competition_series_id,
  em.competition_kind,
  em.stage_id,
  em.stage_group_id,
  em.scheduled_at,
  em.source_updated_at,
  pms."playerId" AS player_id,
  p."teamId" AS team_id,
  p."position"::TEXT AS position,
  player_coverage.coverage_state AS player_box_score_coverage,
  net_points_coverage.coverage_state AS net_points_coverage,
  super_shots_coverage.coverage_state AS super_shots_coverage,
  pms."minutesPlayed" AS minutes_played,
  pms."goals",
  pms."attempts",
  pms."goalAssists" AS goal_assists,
  pms."intercepts",
  pms."deflections",
  pms."rebounds",
  pms."penalties",
  pms."feeds",
  pms."centrePassReceives" AS centre_pass_receives,
  pms."turnovers",
  pms."gain" AS gains,
  pms."pickups",
  pms."netPoints" AS net_points,
  pms."goal2" AS two_point_goals,
  pms."attempt2" AS two_point_attempts
FROM analytics.eligible_match em
JOIN public."PlayerMatchStats" pms ON pms."matchId" = em.match_id
JOIN public."Player" p ON p."id" = pms."playerId"
JOIN analytics.match_capability_coverage player_coverage
  ON player_coverage.match_id = em.match_id
 AND player_coverage.capability = 'PLAYER_BOX_SCORE'::public."DataCapability"
LEFT JOIN analytics.match_capability_coverage net_points_coverage
  ON net_points_coverage.match_id = em.match_id
 AND net_points_coverage.capability = 'NET_POINTS'::public."DataCapability"
LEFT JOIN analytics.match_capability_coverage super_shots_coverage
  ON super_shots_coverage.match_id = em.match_id
 AND super_shots_coverage.capability = 'SUPER_SHOTS'::public."DataCapability"
WHERE player_coverage.coverage_state IN (
  'AVAILABLE'::public."CoverageState",
  'PARTIAL'::public."CoverageState"
);

CREATE VIEW analytics.team_match_fact
WITH (security_barrier = true)
AS
SELECT
  em.match_id,
  em.competition_id,
  em.competition_series_id,
  em.competition_kind,
  em.stage_id,
  em.stage_group_id,
  em.scheduled_at,
  em.source_updated_at,
  tms."teamId" AS team_id,
  tms."isHome" AS is_home,
  team_coverage.coverage_state AS team_box_score_coverage,
  net_points_coverage.coverage_state AS net_points_coverage,
  tms."goals",
  tms."goalAttempts" AS attempts,
  tms."goalAssists" AS goal_assists,
  tms."intercepts",
  tms."deflections",
  tms."rebounds",
  tms."penalties",
  tms."feeds",
  tms."centrePassReceives" AS centre_pass_receives,
  tms."turnovers",
  tms."gain" AS gains,
  tms."pickups",
  tms."netPoints" AS net_points
FROM analytics.eligible_match em
JOIN public."TeamMatchStats" tms ON tms."matchId" = em.match_id
JOIN analytics.match_capability_coverage team_coverage
  ON team_coverage.match_id = em.match_id
 AND team_coverage.capability = 'TEAM_BOX_SCORE'::public."DataCapability"
LEFT JOIN analytics.match_capability_coverage net_points_coverage
  ON net_points_coverage.match_id = em.match_id
 AND net_points_coverage.capability = 'NET_POINTS'::public."DataCapability"
WHERE team_coverage.coverage_state IN (
  'AVAILABLE'::public."CoverageState",
  'PARTIAL'::public."CoverageState"
);

CREATE VIEW analytics.player_edition_summary
WITH (security_barrier = true)
AS
SELECT
  fact.competition_id,
  fact.competition_series_id,
  fact.competition_kind,
  fact.player_id,
  fact.position,
  COUNT(*)::INTEGER AS games,
  SUM(fact.minutes_played)::DOUBLE PRECISION AS minutes,
  SUM(fact.goals)::BIGINT AS goals,
  SUM(fact.attempts)::BIGINT AS attempts,
  SUM(fact.goal_assists)::BIGINT AS goal_assists,
  SUM(fact.intercepts)::BIGINT AS intercepts,
  SUM(fact.gains)::BIGINT AS gains,
  SUM(fact.turnovers)::BIGINT AS turnovers,
  SUM(fact.penalties)::BIGINT AS penalties,
  SUM(fact.goals)::DOUBLE PRECISION / COUNT(*) AS goals_per_game,
  SUM(fact.goals)::DOUBLE PRECISION / NULLIF(SUM(fact.minutes_played), 0) * 60 AS goals_per_60,
  SUM(fact.intercepts)::DOUBLE PRECISION / NULLIF(SUM(fact.minutes_played), 0) * 60 AS intercepts_per_60,
  SUM(fact.goals)::DOUBLE PRECISION / NULLIF(SUM(fact.attempts), 0) * 100 AS goal_accuracy,
  CASE
    WHEN BOOL_AND(fact.player_box_score_coverage = 'AVAILABLE'::public."CoverageState")
      THEN 'AVAILABLE'::public."CoverageState"
    ELSE 'PARTIAL'::public."CoverageState"
  END AS coverage_state,
  MAX(COALESCE(fact.source_updated_at, fact.scheduled_at)) AS as_of,
  ARRAY_AGG(fact.match_id ORDER BY fact.scheduled_at, fact.match_id) AS included_match_ids
FROM analytics.player_match_fact fact
GROUP BY
  fact.competition_id,
  fact.competition_series_id,
  fact.competition_kind,
  fact.player_id,
  fact.position;

CREATE VIEW analytics.team_edition_summary
WITH (security_barrier = true)
AS
SELECT
  fact.competition_id,
  fact.competition_series_id,
  fact.competition_kind,
  fact.team_id,
  COUNT(*)::INTEGER AS games,
  SUM(fact.goals)::BIGINT AS goals,
  SUM(fact.attempts)::BIGINT AS attempts,
  SUM(fact.goal_assists)::BIGINT AS goal_assists,
  SUM(fact.intercepts)::BIGINT AS intercepts,
  SUM(fact.gains)::BIGINT AS gains,
  SUM(fact.turnovers)::BIGINT AS turnovers,
  SUM(fact.penalties)::BIGINT AS penalties,
  SUM(fact.goals)::DOUBLE PRECISION / COUNT(*) AS goals_per_game,
  SUM(fact.goals)::DOUBLE PRECISION / NULLIF(SUM(fact.attempts), 0) * 100 AS goal_accuracy,
  CASE
    WHEN BOOL_AND(fact.team_box_score_coverage = 'AVAILABLE'::public."CoverageState")
      THEN 'AVAILABLE'::public."CoverageState"
    ELSE 'PARTIAL'::public."CoverageState"
  END AS coverage_state,
  MAX(COALESCE(fact.source_updated_at, fact.scheduled_at)) AS as_of,
  ARRAY_AGG(fact.match_id ORDER BY fact.scheduled_at, fact.match_id) AS included_match_ids
FROM analytics.team_match_fact fact
GROUP BY
  fact.competition_id,
  fact.competition_series_id,
  fact.competition_kind,
  fact.team_id;

CREATE VIEW analytics.player_form
WITH (security_barrier = true)
AS
SELECT
  fact.*,
  ROW_NUMBER() OVER (
    PARTITION BY fact.competition_id, fact.player_id
    ORDER BY fact.scheduled_at DESC, fact.match_id DESC
  ) AS edition_recency
FROM analytics.player_match_fact fact;

-- Percentiles are edition- and position-scoped. Explicit competition kind and
-- series columns make it impossible for callers to silently combine club and
-- international populations without opting into a separate calculation.
CREATE VIEW analytics.player_edition_population
WITH (security_barrier = true)
AS
SELECT
  summary.*,
  PERCENT_RANK() OVER (
    PARTITION BY summary.competition_kind, summary.competition_id, summary.position
    ORDER BY summary.goals_per_60
  ) * 100 AS goals_per_60_percentile,
  PERCENT_RANK() OVER (
    PARTITION BY summary.competition_kind, summary.competition_id, summary.position
    ORDER BY summary.intercepts_per_60
  ) * 100 AS intercepts_per_60_percentile
FROM analytics.player_edition_summary summary
WHERE summary.minutes > 0;

CREATE VIEW analytics.ranking_snapshot_read
WITH (security_barrier = true)
AS SELECT * FROM analytics.ranking_snapshot;

CREATE VIEW analytics.record_entry_read
WITH (security_barrier = true)
AS SELECT * FROM analytics.record_entry;

-- Keep source-table privileges away from the eventual analytics login. These
-- partial indexes support the common eligible-match and effective-coverage paths.
CREATE INDEX "Match_analytics_eligible_idx"
  ON public."Match" ("competitionId", "scheduledAt" DESC, "id")
  WHERE "status" = 'COMPLETED'::public."MatchStatus"
    AND "resultQuality" IN (
      'OFFICIAL_FINAL'::public."ResultQualityStatus",
      'CORRECTED'::public."ResultQualityStatus"
    )
    AND "isSimulation" = false;

CREATE INDEX "DataCoverage_match_capability_state_analytics_idx"
  ON public."DataCoverage" ("matchId", "capability", "state")
  WHERE "matchId" IS NOT NULL;

CREATE OR REPLACE FUNCTION analytics.queue_match_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_match_id TEXT;
  target_competition_id TEXT;
  is_eligible BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'Match' THEN
    target_match_id := NEW."id";
    target_competition_id := NEW."competitionId";
    is_eligible := NEW."status" = 'COMPLETED'::public."MatchStatus"
      AND NEW."resultQuality" IN (
        'OFFICIAL_FINAL'::public."ResultQualityStatus",
        'CORRECTED'::public."ResultQualityStatus"
      )
      AND NEW."isSimulation" = false;
  ELSE
    target_match_id := NEW."matchId";
    SELECT
      m."competitionId",
      m."status" = 'COMPLETED'::public."MatchStatus"
        AND m."resultQuality" IN (
          'OFFICIAL_FINAL'::public."ResultQualityStatus",
          'CORRECTED'::public."ResultQualityStatus"
        )
        AND m."isSimulation" = false
    INTO target_competition_id, is_eligible
    FROM public."Match" m
    WHERE m."id" = target_match_id;
  END IF;

  IF COALESCE(is_eligible, false) THEN
    INSERT INTO analytics.cache_invalidation (
      match_id, competition_id, reason, revision, invalidated_at
    ) VALUES (
      target_match_id, target_competition_id, TG_ARGV[0], 1, CURRENT_TIMESTAMP
    )
    ON CONFLICT (match_id) DO UPDATE SET
      competition_id = EXCLUDED.competition_id,
      reason = EXCLUDED.reason,
      revision = analytics.cache_invalidation.revision + 1,
      invalidated_at = CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION analytics.queue_match_invalidation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER analytics_match_finalization_invalidation
AFTER INSERT OR UPDATE OF "status", "resultQuality", "isSimulation", "updatedAt"
ON public."Match"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('MATCH_FINALIZED_OR_CORRECTED');

CREATE TRIGGER analytics_player_stats_invalidation
AFTER INSERT OR UPDATE ON public."PlayerMatchStats"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('PLAYER_STATS_CHANGED');

CREATE TRIGGER analytics_team_stats_invalidation
AFTER INSERT OR UPDATE ON public."TeamMatchStats"
FOR EACH ROW EXECUTE FUNCTION analytics.queue_match_invalidation('TEAM_STATS_CHANGED');

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM PUBLIC, anon, authenticated;
