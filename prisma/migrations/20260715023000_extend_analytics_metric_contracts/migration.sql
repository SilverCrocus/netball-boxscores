-- CP-06 consumes these registered team differential fields without owning DDL.
CREATE OR REPLACE VIEW analytics.team_match_fact AS
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
  coverage.team_box_score_coverage,
  coverage.net_points_coverage,
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
  tms."netPoints" AS net_points,
  (tms."goals" - opponent."goals")::DOUBLE PRECISION AS goal_differential,
  (opponent."turnovers" - tms."turnovers")::DOUBLE PRECISION AS turnover_differential,
  (
    tms."goals"::DOUBLE PRECISION / NULLIF(tms."goalAttempts", 0) * 100
    - opponent."goals"::DOUBLE PRECISION / NULLIF(opponent."goalAttempts", 0) * 100
  ) AS shooting_percentage_differential
FROM analytics.eligible_match em
JOIN public."TeamMatchStats" tms ON tms."matchId" = em.match_id
JOIN public."TeamMatchStats" opponent
  ON opponent."matchId" = tms."matchId"
 AND opponent."teamId" <> tms."teamId"
JOIN analytics.match_coverage coverage ON coverage.match_id = em.match_id
WHERE coverage.team_box_score_coverage IN (
  'AVAILABLE'::public."CoverageState",
  'PARTIAL'::public."CoverageState"
);

CREATE OR REPLACE VIEW analytics.team_edition_summary AS
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
  ARRAY_AGG(fact.match_id ORDER BY fact.scheduled_at, fact.match_id) AS included_match_ids,
  SUM(fact.goal_differential)::DOUBLE PRECISION AS goal_differential,
  AVG(fact.goal_differential)::DOUBLE PRECISION AS goal_differential_per_game,
  SUM(fact.turnover_differential)::DOUBLE PRECISION AS turnover_differential,
  AVG(fact.turnover_differential)::DOUBLE PRECISION AS turnover_differential_per_game,
  AVG(fact.shooting_percentage_differential)::DOUBLE PRECISION AS shooting_percentage_differential
FROM analytics.team_match_fact fact
GROUP BY
  fact.competition_id,
  fact.competition_series_id,
  fact.competition_kind,
  fact.team_id;

REVOKE ALL ON analytics.team_match_fact FROM PUBLIC, anon, authenticated;
REVOKE ALL ON analytics.team_edition_summary FROM PUBLIC, anon, authenticated;
