\set ON_ERROR_STOP on

\if :{?analytics_password}
\else
  \echo 'analytics_password is required. Pass it with --set=analytics_password=...'
  \quit
\endif

-- This script is intentionally operational rather than a Prisma migration:
-- credentials must be created and rotated outside source-controlled DDL.
SELECT format(
  'CREATE ROLE centrepass_analytics LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'analytics_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'centrepass_analytics')
\gexec

SELECT format(
  'ALTER ROLE centrepass_analytics LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'analytics_password'
)
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO centrepass_analytics', current_database())
\gexec

GRANT USAGE ON SCHEMA analytics TO centrepass_analytics;
REVOKE ALL ON SCHEMA public FROM centrepass_analytics;
REVOKE CREATE ON SCHEMA analytics FROM centrepass_analytics;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM centrepass_analytics;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM centrepass_analytics;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM centrepass_analytics;
REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM centrepass_analytics;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM centrepass_analytics;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM centrepass_analytics;

SELECT
  NOT has_schema_privilege('centrepass_analytics', 'public', 'CREATE')
  AND NOT has_schema_privilege('centrepass_analytics', 'analytics', 'CREATE')
  AS no_schema_create
\gset

\if :no_schema_create
  \echo 'Verified: centrepass_analytics cannot create objects in application schemas.'
\else
  \echo 'FAILED: centrepass_analytics inherited schema CREATE privileges.'
  \quit
\endif

-- Explicit allowlist: adding a new analytics view does not grant it to the
-- public query application by accident. Keep this list in lockstep with the
-- repository queries and the static role-contract test.
GRANT SELECT ON analytics.competition_directory TO centrepass_analytics;
GRANT SELECT ON analytics.player_match_read TO centrepass_analytics;
GRANT SELECT ON analytics.team_match_read TO centrepass_analytics;
GRANT SELECT ON analytics.player_directory TO centrepass_analytics;
GRANT SELECT ON analytics.team_directory TO centrepass_analytics;
GRANT SELECT ON analytics.player_alias_directory TO centrepass_analytics;
GRANT SELECT ON analytics.team_alias_directory TO centrepass_analytics;
GRANT SELECT ON analytics.stage_directory TO centrepass_analytics;
GRANT SELECT ON analytics.stage_group_directory TO centrepass_analytics;
GRANT SELECT ON analytics.player_edition_directory TO centrepass_analytics;
GRANT SELECT ON analytics.team_edition_directory TO centrepass_analytics;
GRANT SELECT ON analytics.team_power_match TO centrepass_analytics;
GRANT SELECT ON analytics.opponent_match_directory TO centrepass_analytics;
GRANT SELECT ON analytics.cache_revision_read TO centrepass_analytics;

SELECT format(
  'ALTER ROLE centrepass_analytics IN DATABASE %I SET default_transaction_read_only = on',
  current_database()
)
\gexec
SELECT format(
  'ALTER ROLE centrepass_analytics IN DATABASE %I SET statement_timeout = %L',
  current_database(),
  '2s'
)
\gexec
SELECT format(
  'ALTER ROLE centrepass_analytics IN DATABASE %I SET search_path = %L',
  current_database(),
  'analytics'
)
\gexec

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('analytics', 'pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND n.nspname NOT LIKE 'pg_temp%'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege(
      'centrepass_analytics',
      format('%I.%I', n.nspname, c.relname),
      'SELECT'
    )
) AS outside_select_isolation_ok
\gset

\if :outside_select_isolation_ok
  \echo 'Verified: centrepass_analytics cannot SELECT outside analytics.'
\else
  \echo 'FAILED: centrepass_analytics inherited SELECT outside analytics.'
  \quit
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname NOT LIKE 'pg_toast%'
    AND namespace.nspname NOT LIKE 'pg_temp%'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (
      has_table_privilege('centrepass_analytics', relation.oid, 'INSERT')
      OR has_table_privilege('centrepass_analytics', relation.oid, 'UPDATE')
      OR has_table_privilege('centrepass_analytics', relation.oid, 'DELETE')
      OR has_table_privilege('centrepass_analytics', relation.oid, 'TRUNCATE')
      OR has_table_privilege('centrepass_analytics', relation.oid, 'TRIGGER')
      OR has_table_privilege('centrepass_analytics', relation.oid, 'REFERENCES')
    )
) AS no_write_grants
\gset

\if :no_write_grants
  \echo 'Verified: centrepass_analytics has no table write grants.'
\else
  \echo 'FAILED: centrepass_analytics has a table write grant.'
  \quit
\endif

WITH allowed(schema_name, relation_name) AS (
  VALUES
    ('analytics', 'competition_directory'),
    ('analytics', 'player_match_read'),
    ('analytics', 'team_match_read'),
    ('analytics', 'player_directory'),
    ('analytics', 'team_directory'),
    ('analytics', 'player_alias_directory'),
    ('analytics', 'team_alias_directory'),
    ('analytics', 'stage_directory'),
    ('analytics', 'stage_group_directory'),
    ('analytics', 'player_edition_directory'),
    ('analytics', 'team_edition_directory'),
    ('analytics', 'team_power_match'),
    ('analytics', 'opponent_match_directory'),
    ('analytics', 'cache_revision_read')
)
SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'analytics'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege(
      'centrepass_analytics',
      format('%I.%I', namespace.nspname, relation.relname),
      'SELECT'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM allowed
      WHERE allowed.schema_name = namespace.nspname
        AND allowed.relation_name = relation.relname
    )
) AND NOT EXISTS (
  SELECT 1
  FROM allowed
  WHERE NOT has_table_privilege(
    'centrepass_analytics',
    format('%I.%I', allowed.schema_name, allowed.relation_name),
    'SELECT'
  )
) AS exact_view_allowlist_ok
\gset

\if :exact_view_allowlist_ok
  \echo 'Verified: centrepass_analytics SELECT privileges exactly match the reviewed allowlist.'
\else
  \echo 'FAILED: centrepass_analytics SELECT privileges differ from the reviewed allowlist.'
  \quit
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('analytics', 'pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg_temp%'
    AND p.prosecdef
    AND has_function_privilege('centrepass_analytics', p.oid, 'EXECUTE')
) AS no_external_security_definer_execution
\gset

\if :no_external_security_definer_execution
  \echo 'Verified: centrepass_analytics cannot execute external security-definer functions.'
\else
  \echo 'FAILED: centrepass_analytics can execute a security-definer function outside analytics.'
  \quit
\endif
