-- Supabase projects created with older default ACLs can automatically grant
-- Data API roles access to later Prisma objects. Close both the current public
-- schema and the postgres-owned future object defaults. service_role is also
-- a Data API role and receives no implicit access; server access uses the
-- dedicated direct database credentials provisioned later in the release.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;

-- These trigger functions were present before this migration and had inherited
-- broad Data API EXECUTE grants. Name them explicitly so an access review can
-- verify the current-object repair independently of the schema-wide revoke.
REVOKE EXECUTE ON FUNCTION public.cp_prepare_legacy_match_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cp_sync_legacy_match_foundation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cp_validate_competition_topology()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES
  FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- supabase_admin is a provider-managed role on hosted Supabase projects and
-- postgres is not expected to be a member. Do not make a Prisma migration
-- depend on privileges it cannot own. Release verification audits those
-- provider-owned defaults and application-object ownership separately; all
-- CentrePass migrations and runtime objects must remain postgres-owned.

-- This migration creates the complete database boundary consumed by public
-- analytics features. Application query credentials receive SELECT only on
-- the reviewed views listed in scripts/provision-analytics-role.sql. They do
-- not receive privileges on the source tables behind these owner-run views.

-- Canonical players can be shared by club and international editions. Resolve
-- the team (and edition-specific position) from the roster that belongs to the
-- match's edition and one of its two sides. Historical REPLACED/WITHDRAWN rows
-- remain eligible when their validity period covers the match. If roster dates
-- are incomplete, prefer the nearest membership in that edition; never expose
-- the player's legacy club unless it is genuinely a side in this match.
CREATE OR REPLACE VIEW analytics.player_match_fact
WITH (security_barrier = true)
AS
SELECT
  eligible.match_id,
  eligible.competition_id,
  eligible.competition_series_id,
  eligible.competition_kind,
  eligible.stage_id,
  eligible.stage_group_id,
  eligible.scheduled_at,
  eligible.source_updated_at,
  player_stats."playerId" AS player_id,
  COALESCE(
    edition_roster.team_id,
    CASE
      WHEN player."teamId" IN (eligible.home_team_id, eligible.away_team_id)
        THEN player."teamId"
      ELSE NULL
    END
  ) AS team_id,
  COALESCE(edition_roster.designated_position, player."position"::TEXT) AS position,
  coverage.player_box_score_coverage,
  coverage.net_points_coverage,
  coverage.super_shots_coverage,
  player_stats."minutesPlayed" AS minutes_played,
  player_stats."goals",
  player_stats."attempts",
  player_stats."goalAssists" AS goal_assists,
  player_stats."intercepts",
  player_stats."deflections",
  player_stats."rebounds",
  player_stats."penalties",
  player_stats."feeds",
  player_stats."centrePassReceives" AS centre_pass_receives,
  player_stats."turnovers",
  player_stats."gain" AS gains,
  player_stats."pickups",
  player_stats."netPoints" AS net_points,
  player_stats."goal2" AS two_point_goals,
  player_stats."attempt2" AS two_point_attempts
FROM analytics.eligible_match eligible
JOIN public."PlayerMatchStats" player_stats
  ON player_stats."matchId" = eligible.match_id
JOIN public."Player" player ON player."id" = player_stats."playerId"
LEFT JOIN LATERAL (
  SELECT
    entry."teamId" AS team_id,
    membership."designatedPosition"::TEXT AS designated_position
  FROM public."RosterMembership" membership
  JOIN public."EditionEntry" entry ON entry."id" = membership."editionEntryId"
  WHERE membership."playerId" = player."id"
    AND entry."competitionId" = eligible.competition_id
    AND entry."teamId" IN (eligible.home_team_id, eligible.away_team_id)
  ORDER BY
    CASE
      WHEN membership."validFrom" <= eligible.scheduled_at
        AND (membership."validTo" IS NULL OR membership."validTo" >= eligible.scheduled_at)
        THEN 0
      WHEN membership."validFrom" <= eligible.scheduled_at THEN 1
      ELSE 2
    END,
    CASE membership."status"
      WHEN 'ACTIVE'::public."RosterMembershipStatus" THEN 0
      WHEN 'REPLACED'::public."RosterMembershipStatus" THEN 1
      ELSE 2
    END,
    CASE WHEN membership."validFrom" <= eligible.scheduled_at THEN membership."validFrom" END DESC,
    CASE WHEN membership."validFrom" > eligible.scheduled_at THEN membership."validFrom" END ASC,
    membership."id"
  LIMIT 1
) edition_roster ON true
JOIN analytics.match_coverage coverage ON coverage.match_id = eligible.match_id
WHERE coverage.player_box_score_coverage IN (
  'AVAILABLE'::public."CoverageState",
  'PARTIAL'::public."CoverageState"
);

CREATE VIEW analytics.competition_directory AS
SELECT
  competition."id" AS competition_id,
  competition."season",
  competition."name" AS competition_name,
  competition."slug" AS competition_slug,
  competition."label" AS competition_label,
  competition."seasonStart" AS season_start,
  competition."seasonEnd" AS season_end,
  competition."sourceTimezone" AS source_timezone,
  series."id" AS series_id,
  series."slug" AS series_slug,
  series."name" AS series_name,
  series."kind"::TEXT AS competition_kind
FROM public."Competition" competition
JOIN public."CompetitionSeries" series ON series."id" = competition."seriesId"
WHERE competition."publicationStatus" = 'PUBLISHED'::public."PublicationStatus"
  AND competition."slug" IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM public."EditionEntry" entry
    WHERE entry."competitionId" = competition."id"
      AND entry."status" = 'ACTIVE'::public."EditionEntryStatus"
  ) >= 2
  AND (
    SELECT COUNT(*)
    FROM public."Match" match
    WHERE match."competitionId" = competition."id"
  ) >= 1
  AND EXISTS (
    SELECT 1
    FROM public."Match" eligible_match
    WHERE eligible_match."competitionId" = competition."id"
      AND eligible_match."status" = 'COMPLETED'::public."MatchStatus"
      AND eligible_match."resultQuality" IN (
        'OFFICIAL_FINAL'::public."ResultQualityStatus",
        'CORRECTED'::public."ResultQualityStatus"
      )
      AND eligible_match."isSimulation" = false
  )
  AND (
    series."slug" <> 'commonwealth-games-netball'
    OR competition."slug" <> 'glasgow-2026'
    OR (
      (
        SELECT COUNT(*)
        FROM public."EditionEntry" entry
        WHERE entry."competitionId" = competition."id"
          AND entry."status" = 'ACTIVE'::public."EditionEntryStatus"
      ) = 12
      AND (
        SELECT COUNT(*)
        FROM public."Match" match
        WHERE match."competitionId" = competition."id"
      ) = 38
      AND (
        SELECT COUNT(*)
        FROM public."MatchSlot" slot
        JOIN public."Match" match ON match."id" = slot."matchId"
        WHERE match."competitionId" = competition."id"
      ) = 76
      AND EXISTS (
        SELECT 1
        FROM public."ImportRun" import_run
        JOIN public."SourceSystem" source_system
          ON source_system."id" = import_run."sourceSystemId"
        WHERE import_run."competitionId" = competition."id"
          AND source_system."key" = 'glasgow-2026-public-data'
          AND import_run."status" = 'SUCCEEDED'::public."ImportStatus"
          AND import_run."dryRun" = false
          AND import_run."issueCount" = 0
      )
      AND (
        SELECT COUNT(*)
        FROM public."Stage" stage
        WHERE stage."competitionId" = competition."id"
          AND stage."isPublished" = true
          AND (
            (stage."slug" = 'pool-stage'
              AND stage."type" = 'POOL'::public."StageType"
              AND stage."sequence" = 1
              AND (SELECT COUNT(*) FROM public."StageGroup" stage_group WHERE stage_group."stageId" = stage."id") = 2
              AND (SELECT COUNT(*) FROM public."Match" match WHERE match."stageId" = stage."id") = 30)
            OR (stage."slug" = 'classification'
              AND stage."type" = 'CLASSIFICATION'::public."StageType"
              AND stage."sequence" = 2
              AND (SELECT COUNT(*) FROM public."StageGroup" stage_group WHERE stage_group."stageId" = stage."id") = 0
              AND (SELECT COUNT(*) FROM public."Match" match WHERE match."stageId" = stage."id") = 4)
            OR (stage."slug" = 'semi-finals'
              AND stage."type" = 'SEMI_FINALS'::public."StageType"
              AND stage."sequence" = 3
              AND (SELECT COUNT(*) FROM public."StageGroup" stage_group WHERE stage_group."stageId" = stage."id") = 0
              AND (SELECT COUNT(*) FROM public."Match" match WHERE match."stageId" = stage."id") = 2)
            OR (stage."slug" = 'medal-matches'
              AND stage."type" = 'MEDAL_MATCHES'::public."StageType"
              AND stage."sequence" = 4
              AND (SELECT COUNT(*) FROM public."StageGroup" stage_group WHERE stage_group."stageId" = stage."id") = 0
              AND (SELECT COUNT(*) FROM public."Match" match WHERE match."stageId" = stage."id") = 2)
          )
      ) = 4
      AND (
        SELECT COUNT(*)
        FROM public."Stage" stage
        WHERE stage."competitionId" = competition."id"
      ) = 4
    )
  );

-- The underlying fact views remain private implementation details because they
-- include every eligible match, including unpublished editions. These are the
-- only fact surfaces granted to the runtime analytics role.
CREATE VIEW analytics.player_match_read AS
SELECT fact.*
FROM analytics.player_match_fact fact
JOIN analytics.competition_directory competition
  ON competition.competition_id = fact.competition_id
LEFT JOIN public."Stage" stage
  ON stage."id" = fact.stage_id
  AND stage."competitionId" = fact.competition_id
WHERE fact.stage_id IS NULL
  OR stage."isPublished" = true;

CREATE VIEW analytics.team_match_read AS
SELECT fact.*
FROM analytics.team_match_fact fact
JOIN analytics.competition_directory competition
  ON competition.competition_id = fact.competition_id
LEFT JOIN public."Stage" stage
  ON stage."id" = fact.stage_id
  AND stage."competitionId" = fact.competition_id
WHERE fact.stage_id IS NULL
  OR stage."isPublished" = true;

CREATE VIEW analytics.team_edition_directory AS
SELECT
  entry."competitionId" AS competition_id,
  team."id" AS team_id,
  COALESCE(entry."displayName", team."name") AS team_name,
  team."slug" AS team_slug,
  team."abbreviation" AS team_abbreviation
FROM public."EditionEntry" entry
JOIN analytics.competition_directory competition
  ON competition.competition_id = entry."competitionId"
JOIN public."Team" team ON team."id" = entry."teamId"
WHERE entry."status" = 'ACTIVE'::public."EditionEntryStatus";

CREATE VIEW analytics.player_edition_directory AS
WITH edition_player_candidates AS (
  SELECT
    entry."competitionId" AS competition_id,
    membership."playerId" AS player_id,
    entry."teamId" AS team_id,
    membership."designatedPosition"::TEXT AS position,
    membership."validFrom" AS effective_at,
    0 AS source_priority
  FROM public."RosterMembership" membership
  JOIN public."EditionEntry" entry ON entry."id" = membership."editionEntryId"
  JOIN analytics.competition_directory competition
    ON competition.competition_id = entry."competitionId"
  WHERE entry."status" = 'ACTIVE'::public."EditionEntryStatus"
    AND membership."status" = 'ACTIVE'::public."RosterMembershipStatus"

  UNION ALL

  SELECT
    fact.competition_id,
    fact.player_id,
    fact.team_id,
    fact.position,
    fact.scheduled_at AS effective_at,
    1 AS source_priority
  FROM analytics.player_match_read fact
),
edition_players AS (
  SELECT DISTINCT ON (competition_id, player_id)
    competition_id,
    player_id,
    team_id,
    position
  FROM edition_player_candidates
  WHERE team_id IS NOT NULL
  ORDER BY
    competition_id,
    player_id,
    (position IS NULL),
    source_priority,
    effective_at DESC NULLS LAST,
    team_id
)
SELECT DISTINCT
  edition_players.competition_id,
  player."id" AS player_id,
  player."name" AS player_name,
  COALESCE(edition_players.position, player."position"::TEXT) AS position,
  team."id" AS team_id,
  team."name" AS team_name
FROM edition_players
JOIN public."Player" player ON player."id" = edition_players.player_id
JOIN public."Team" team ON team."id" = edition_players.team_id;

CREATE VIEW analytics.player_directory AS
SELECT DISTINCT ON (player."id")
  player."id" AS player_id,
  player."name" AS player_name,
  edition_player.position,
  team."id" AS team_id,
  team."name" AS team_name
FROM analytics.player_edition_directory edition_player
JOIN public."Player" player ON player."id" = edition_player.player_id
JOIN public."Team" team ON team."id" = edition_player.team_id
JOIN analytics.competition_directory competition
  ON competition.competition_id = edition_player.competition_id
ORDER BY
  player."id",
  competition.season_start DESC NULLS LAST,
  competition.season DESC,
  competition.competition_id DESC,
  team."id";

CREATE VIEW analytics.team_directory AS
SELECT DISTINCT
  team."id" AS team_id,
  team."name" AS team_name,
  team."slug" AS team_slug,
  team."abbreviation" AS team_abbreviation
FROM analytics.team_edition_directory edition_team
JOIN public."Team" team ON team."id" = edition_team.team_id;

CREATE VIEW analytics.player_alias_directory AS
SELECT alias."playerId" AS player_id, alias."alias"
FROM public."PlayerAlias" alias
JOIN analytics.player_directory player ON player.player_id = alias."playerId";

CREATE VIEW analytics.team_alias_directory AS
SELECT alias."teamId" AS team_id, alias."alias"
FROM public."TeamAlias" alias
JOIN analytics.team_directory team ON team.team_id = alias."teamId";

CREATE VIEW analytics.stage_directory AS
SELECT
  stage."id" AS stage_id,
  stage."competitionId" AS competition_id,
  stage."name" AS stage_name,
  stage."slug" AS stage_slug,
  stage."type"::TEXT AS stage_type
FROM public."Stage" stage
JOIN analytics.competition_directory competition
  ON competition.competition_id = stage."competitionId"
WHERE stage."isPublished" = true;

CREATE VIEW analytics.stage_group_directory AS
SELECT
  stage_group."id" AS stage_group_id,
  stage."competitionId" AS competition_id,
  stage_group."name" AS stage_group_name,
  stage_group."slug" AS stage_group_slug
FROM public."StageGroup" stage_group
JOIN analytics.stage_directory stage ON stage.stage_id = stage_group."stageId";

CREATE VIEW analytics.team_power_match AS
SELECT
  eligible.match_id,
  eligible.competition_id,
  eligible.competition_series_id,
  eligible.competition_kind,
  eligible.scheduled_at,
  eligible.source_updated_at,
  match."neutralVenue" AS neutral_venue,
  match."homeTeamId" AS home_team_id,
  match."awayTeamId" AS away_team_id,
  match."homeScore" AS home_score,
  match."awayScore" AS away_score
FROM analytics.eligible_match eligible
JOIN analytics.competition_directory competition
  ON competition.competition_id = eligible.competition_id
JOIN public."Match" match ON match."id" = eligible.match_id
LEFT JOIN public."Stage" stage
  ON stage."id" = eligible.stage_id
  AND stage."competitionId" = eligible.competition_id
WHERE match."homeTeamId" IS NOT NULL
  AND match."awayTeamId" IS NOT NULL
  AND (
    eligible.stage_id IS NULL
    OR stage."isPublished" = true
  );

CREATE VIEW analytics.opponent_match_directory AS
SELECT eligible.match_id, eligible.competition_id, eligible.home_team_id AS team_id
FROM analytics.eligible_match eligible
JOIN analytics.competition_directory competition
  ON competition.competition_id = eligible.competition_id
LEFT JOIN public."Stage" stage
  ON stage."id" = eligible.stage_id
  AND stage."competitionId" = eligible.competition_id
WHERE eligible.home_team_id IS NOT NULL
  AND (
    eligible.stage_id IS NULL
    OR stage."isPublished" = true
  )
UNION ALL
SELECT eligible.match_id, eligible.competition_id, eligible.away_team_id AS team_id
FROM analytics.eligible_match eligible
JOIN analytics.competition_directory competition
  ON competition.competition_id = eligible.competition_id
LEFT JOIN public."Stage" stage
  ON stage."id" = eligible.stage_id
  AND stage."competitionId" = eligible.competition_id
WHERE eligible.away_team_id IS NOT NULL
  AND (
    eligible.stage_id IS NULL
    OR stage."isPublished" = true
  );

CREATE VIEW analytics.cache_revision_read AS
SELECT
  COALESCE(MAX(invalidation.revision), 0)::BIGINT AS revision,
  MAX(invalidation.invalidated_at) AS invalidated_at
FROM analytics.cache_invalidation invalidation;

-- Rate-limit reservations are intentionally separated from product telemetry.
-- This makes retention and privacy guarantees independently enforceable.
CREATE TABLE analytics.query_rate_limit_bucket (
  key_hash TEXT NOT NULL,
  bucket_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 30),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key_hash, bucket_started_at),
  CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX query_rate_limit_bucket_retention_idx
  ON analytics.query_rate_limit_bucket (bucket_started_at);

ALTER TABLE analytics.query_rate_limit_bucket ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON analytics.query_rate_limit_bucket FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION analytics.reserve_stat_query_rate_limit(p_key_hash TEXT)
RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bucket_started_at TIMESTAMPTZ := pg_catalog.date_trunc('minute', pg_catalog.clock_timestamp());
  v_count INTEGER;
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid rate-limit key';
  END IF;

  DELETE FROM analytics.query_rate_limit_bucket bucket
  WHERE bucket.bucket_started_at < pg_catalog.clock_timestamp() - INTERVAL '2 days';

  INSERT INTO analytics.query_rate_limit_bucket (
    key_hash,
    bucket_started_at,
    request_count,
    updated_at
  ) VALUES (
    p_key_hash,
    v_bucket_started_at,
    1,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT (key_hash, bucket_started_at) DO UPDATE SET
    request_count = analytics.query_rate_limit_bucket.request_count + 1,
    updated_at = pg_catalog.clock_timestamp()
  WHERE analytics.query_rate_limit_bucket.request_count < 30
  RETURNING request_count INTO v_count;

  IF v_count IS NULL THEN
    SELECT bucket.request_count
    INTO v_count
    FROM analytics.query_rate_limit_bucket bucket
    WHERE bucket.key_hash = p_key_hash
      AND bucket.bucket_started_at = v_bucket_started_at;
    allowed := false;
  ELSE
    allowed := true;
  END IF;

  remaining := pg_catalog.greatest(0, 30 - COALESCE(v_count, 30));
  retry_after_seconds := pg_catalog.greatest(
    1,
    pg_catalog.ceil(
      pg_catalog.extract(
        EPOCH FROM (v_bucket_started_at + INTERVAL '1 minute' - pg_catalog.clock_timestamp())
      )
    )::INTEGER
  );
  RETURN NEXT;
END;
$$;

CREATE FUNCTION analytics.write_stat_query_telemetry(
  p_question_hash TEXT,
  p_query_spec JSONB,
  p_parser_version TEXT,
  p_result_status TEXT,
  p_result_count INTEGER,
  p_latency_ms INTEGER,
  p_error_code TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_question_hash IS NULL OR p_question_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid question hash';
  END IF;
  IF p_parser_version IS NULL OR pg_catalog.char_length(p_parser_version) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid parser version';
  END IF;
  IF p_result_status IS NULL
    OR p_result_status NOT IN ('READY', 'NEEDS_CLARIFICATION', 'UNSUPPORTED', 'QUERY_TIMEOUT', 'QUERY_UNAVAILABLE')
  THEN
    RAISE EXCEPTION 'invalid result status';
  END IF;
  IF p_result_count IS NULL OR p_result_count NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'invalid result count';
  END IF;
  IF p_latency_ms IS NULL OR p_latency_ms NOT BETWEEN 0 AND 30000 THEN
    RAISE EXCEPTION 'invalid query latency';
  END IF;
  IF p_query_spec IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_query_spec) <> 'object' THEN
      RAISE EXCEPTION 'query specification must be an object';
    END IF;
    IF pg_catalog.pg_column_size(p_query_spec) > 16384 THEN
      RAISE EXCEPTION 'query specification is too large';
    END IF;
  END IF;
  IF p_error_code IS NOT NULL AND pg_catalog.char_length(p_error_code) > 80 THEN
    RAISE EXCEPTION 'error code is too large';
  END IF;

  INSERT INTO analytics.query_telemetry (
    question_hash,
    query_spec,
    parser_version,
    result_status,
    result_count,
    latency_ms,
    error_code
  ) VALUES (
    p_question_hash,
    p_query_spec,
    p_parser_version,
    p_result_status,
    p_result_count,
    p_latency_ms,
    p_error_code
  );
END;
$$;

COMMENT ON FUNCTION analytics.reserve_stat_query_rate_limit(TEXT) IS
  'Atomically reserves one request in the current fixed one-minute bucket.';
COMMENT ON FUNCTION analytics.write_stat_query_telemetry(TEXT, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT) IS
  'Writes privacy-preserving Ask CentrePass telemetry after validating bounded inputs.';

REVOKE ALL ON FUNCTION analytics.reserve_stat_query_rate_limit(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION analytics.write_stat_query_telemetry(TEXT, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON analytics.competition_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.player_match_read FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.team_match_read FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.team_edition_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.player_edition_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.player_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.team_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.player_alias_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.team_alias_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.stage_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.stage_group_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.team_power_match FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.opponent_match_directory FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON analytics.cache_revision_read FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM PUBLIC, anon, authenticated;
