-- Query-plan verification showed that joining the generic ten-capability view
-- once per requested capability caused repeated expansion. Resolve the four
-- box-score capabilities once per match instead.
CREATE VIEW analytics.match_coverage AS
SELECT
  m."id" AS match_id,
  m."competitionId" AS competition_id,
  COALESCE(
    match_player."state",
    edition_player."state",
    'UNAVAILABLE'::public."CoverageState"
  ) AS player_box_score_coverage,
  COALESCE(
    match_team."state",
    edition_team."state",
    'UNAVAILABLE'::public."CoverageState"
  ) AS team_box_score_coverage,
  COALESCE(
    match_net_points."state",
    edition_net_points."state",
    'UNAVAILABLE'::public."CoverageState"
  ) AS net_points_coverage,
  COALESCE(
    match_super_shots."state",
    edition_super_shots."state",
    'UNAVAILABLE'::public."CoverageState"
  ) AS super_shots_coverage
FROM public."Match" m
LEFT JOIN public."DataCoverage" match_player
  ON match_player."competitionId" = m."competitionId"
 AND match_player."matchId" = m."id"
 AND match_player."capability" = 'PLAYER_BOX_SCORE'::public."DataCapability"
LEFT JOIN public."DataCoverage" edition_player
  ON edition_player."competitionId" = m."competitionId"
 AND edition_player."matchId" IS NULL
 AND edition_player."capability" = 'PLAYER_BOX_SCORE'::public."DataCapability"
LEFT JOIN public."DataCoverage" match_team
  ON match_team."competitionId" = m."competitionId"
 AND match_team."matchId" = m."id"
 AND match_team."capability" = 'TEAM_BOX_SCORE'::public."DataCapability"
LEFT JOIN public."DataCoverage" edition_team
  ON edition_team."competitionId" = m."competitionId"
 AND edition_team."matchId" IS NULL
 AND edition_team."capability" = 'TEAM_BOX_SCORE'::public."DataCapability"
LEFT JOIN public."DataCoverage" match_net_points
  ON match_net_points."competitionId" = m."competitionId"
 AND match_net_points."matchId" = m."id"
 AND match_net_points."capability" = 'NET_POINTS'::public."DataCapability"
LEFT JOIN public."DataCoverage" edition_net_points
  ON edition_net_points."competitionId" = m."competitionId"
 AND edition_net_points."matchId" IS NULL
 AND edition_net_points."capability" = 'NET_POINTS'::public."DataCapability"
LEFT JOIN public."DataCoverage" match_super_shots
  ON match_super_shots."competitionId" = m."competitionId"
 AND match_super_shots."matchId" = m."id"
 AND match_super_shots."capability" = 'SUPER_SHOTS'::public."DataCapability"
LEFT JOIN public."DataCoverage" edition_super_shots
  ON edition_super_shots."competitionId" = m."competitionId"
 AND edition_super_shots."matchId" IS NULL
 AND edition_super_shots."capability" = 'SUPER_SHOTS'::public."DataCapability";

CREATE OR REPLACE VIEW analytics.player_match_fact AS
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
  coverage.player_box_score_coverage,
  coverage.net_points_coverage,
  coverage.super_shots_coverage,
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
JOIN analytics.match_coverage coverage ON coverage.match_id = em.match_id
WHERE coverage.player_box_score_coverage IN (
  'AVAILABLE'::public."CoverageState",
  'PARTIAL'::public."CoverageState"
);

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
  tms."netPoints" AS net_points
FROM analytics.eligible_match em
JOIN public."TeamMatchStats" tms ON tms."matchId" = em.match_id
JOIN analytics.match_coverage coverage ON coverage.match_id = em.match_id
WHERE coverage.team_box_score_coverage IN (
  'AVAILABLE'::public."CoverageState",
  'PARTIAL'::public."CoverageState"
);

-- These views are private, unexposed, and explicitly revoked from Data API
-- roles. Security barriers are unnecessary here and prevent predicate pushdown.
ALTER VIEW analytics.match_capability_coverage RESET (security_barrier);
ALTER VIEW analytics.eligible_match RESET (security_barrier);
ALTER VIEW analytics.player_match_fact RESET (security_barrier);
ALTER VIEW analytics.team_match_fact RESET (security_barrier);
ALTER VIEW analytics.player_edition_summary RESET (security_barrier);
ALTER VIEW analytics.team_edition_summary RESET (security_barrier);
ALTER VIEW analytics.player_form RESET (security_barrier);
ALTER VIEW analytics.player_edition_population RESET (security_barrier);
ALTER VIEW analytics.ranking_snapshot_read RESET (security_barrier);
ALTER VIEW analytics.record_entry_read RESET (security_barrier);

REVOKE ALL ON analytics.match_coverage FROM PUBLIC, anon, authenticated;
