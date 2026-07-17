\set ON_ERROR_STOP on

\if :{?operations_password}
\else
  \echo 'operations_password is required. Pass it with --set=operations_password=...'
  \quit
\endif

-- Credentials are provisioned operationally so secrets never enter migration
-- history. This login has no table privileges; it may execute only two
-- bounded SECURITY DEFINER functions in the private analytics schema.
SELECT format(
  'CREATE ROLE centrepass_stats_operations LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'operations_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'centrepass_stats_operations')
\gexec

SELECT format(
  'ALTER ROLE centrepass_stats_operations LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'operations_password'
)
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO centrepass_stats_operations', current_database())
\gexec

GRANT USAGE ON SCHEMA analytics TO centrepass_stats_operations;
REVOKE ALL ON SCHEMA public FROM centrepass_stats_operations;
REVOKE CREATE ON SCHEMA analytics FROM centrepass_stats_operations;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM centrepass_stats_operations;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM centrepass_stats_operations;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM centrepass_stats_operations;
REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM centrepass_stats_operations;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM centrepass_stats_operations;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM centrepass_stats_operations;

SELECT
  NOT has_schema_privilege('centrepass_stats_operations', 'public', 'CREATE')
  AND NOT has_schema_privilege('centrepass_stats_operations', 'analytics', 'CREATE')
  AS no_schema_create
\gset

\if :no_schema_create
  \echo 'Verified: centrepass_stats_operations cannot create objects in application schemas.'
\else
  \echo 'FAILED: centrepass_stats_operations inherited schema CREATE privileges.'
  \quit
\endif

GRANT EXECUTE ON FUNCTION analytics.reserve_stat_query_rate_limit(TEXT)
  TO centrepass_stats_operations;
GRANT EXECUTE ON FUNCTION analytics.write_stat_query_telemetry(TEXT, JSONB, TEXT, TEXT, INTEGER, INTEGER, TEXT)
  TO centrepass_stats_operations;

SELECT format(
  'ALTER ROLE centrepass_stats_operations IN DATABASE %I SET statement_timeout = %L',
  current_database(),
  '2s'
)
\gexec
SELECT format(
  'ALTER ROLE centrepass_stats_operations IN DATABASE %I SET search_path = %L',
  current_database(),
  ''
)
\gexec

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname NOT LIKE 'pg_toast%'
    AND namespace.nspname NOT LIKE 'pg_temp%'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (
      has_table_privilege('centrepass_stats_operations', relation.oid, 'SELECT')
      OR has_table_privilege('centrepass_stats_operations', relation.oid, 'INSERT')
      OR has_table_privilege('centrepass_stats_operations', relation.oid, 'UPDATE')
      OR has_table_privilege('centrepass_stats_operations', relation.oid, 'DELETE')
      OR has_table_privilege('centrepass_stats_operations', relation.oid, 'TRUNCATE')
    )
) AS no_relation_privileges
\gset

\if :no_relation_privileges
  \echo 'Verified: centrepass_stats_operations has no relation privileges.'
\else
  \echo 'FAILED: centrepass_stats_operations can access a relation directly.'
  \quit
\endif

SELECT
  has_function_privilege(
    'centrepass_stats_operations',
    'analytics.reserve_stat_query_rate_limit(text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'centrepass_stats_operations',
    'analytics.write_stat_query_telemetry(text,jsonb,text,text,integer,integer,text)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'analytics'
      AND has_function_privilege('centrepass_stats_operations', routine.oid, 'EXECUTE')
      AND routine.oid NOT IN (
        'analytics.reserve_stat_query_rate_limit(text)'::regprocedure,
        'analytics.write_stat_query_telemetry(text,jsonb,text,text,integer,integer,text)'::regprocedure
      )
  ) AS exact_function_allowlist_ok
\gset

\if :exact_function_allowlist_ok
  \echo 'Verified: centrepass_stats_operations can execute only the reviewed operations functions.'
\else
  \echo 'FAILED: centrepass_stats_operations function privileges differ from the reviewed allowlist.'
  \quit
\endif
