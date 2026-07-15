\set ON_ERROR_STOP on

SET statement_timeout = '5s';

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM analytics.player_form
WHERE competition_id = :'competition_id'
  AND player_id = :'player_id'
  AND edition_recency <= 10
ORDER BY edition_recency;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM analytics.player_edition_population
WHERE competition_id = :'competition_id'
  AND position = :'position'
ORDER BY goals_per_60_percentile DESC
LIMIT 20;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM analytics.team_edition_summary
WHERE competition_id = :'competition_id'
ORDER BY goals_per_game DESC;
