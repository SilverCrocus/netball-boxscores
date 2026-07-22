\set ON_ERROR_STOP on

SET statement_timeout = '5s';

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  match_id, competition_id, player_id, position, minutes_played,
  goals, attempts, goal_assists, intercepts, deflections, rebounds,
  penalties, feeds, centre_pass_receives, turnovers, gains, pickups,
  net_points
FROM analytics.player_match_read
WHERE competition_id = :'competition_id'
ORDER BY scheduled_at, match_id, player_id;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT player_id, player_name, position, team_name
FROM analytics.player_edition_directory edition_player
WHERE competition_id = :'competition_id'
  AND position = :'position'
  AND EXISTS (
    SELECT 1
    FROM analytics.player_match_read fact
    WHERE fact.competition_id = edition_player.competition_id
      AND fact.player_id = edition_player.player_id
  )
ORDER BY team_name, player_name, player_id;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  match_id, competition_id, team_id, goals, attempts, goal_assists,
  intercepts, deflections, rebounds, penalties, feeds,
  centre_pass_receives, turnovers, gains, pickups, net_points,
  goal_differential, turnover_differential,
  shooting_percentage_differential
FROM analytics.team_match_read
WHERE competition_id = :'competition_id'
ORDER BY scheduled_at, match_id, team_id;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  match_id, competition_id, neutral_venue, home_team_id, away_team_id,
  home_score, away_score
FROM analytics.team_power_match
WHERE competition_id = :'competition_id'
ORDER BY scheduled_at, match_id;

-- The cache epoch is a singleton read. Keep this assertion in the reviewed
-- analytics surface so an accidental table scan or expanded cache contract is
-- visible during the role-boundary rehearsal.
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT revision, invalidated_at, contract_version
FROM analytics.cache_revision_read;
