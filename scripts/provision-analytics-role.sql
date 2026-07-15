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
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM centrepass_analytics;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM centrepass_analytics;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM centrepass_analytics;
REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM centrepass_analytics;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA analytics FROM centrepass_analytics;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics FROM centrepass_analytics;

-- Grant reviewed views only. Base tables, telemetry, and the invalidation queue
-- remain inaccessible to this query role.
SELECT format('GRANT SELECT ON %I.%I TO centrepass_analytics', n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'analytics'
  AND c.relkind IN ('v', 'm')
ORDER BY c.relname
\gexec

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
  FROM information_schema.role_table_grants
  WHERE grantee = 'centrepass_analytics'
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
) AS no_write_grants
\gset

\if :no_write_grants
  \echo 'Verified: centrepass_analytics has no table write grants.'
\else
  \echo 'FAILED: centrepass_analytics has a table write grant.'
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
