import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  getAnalyticsDatabase,
  getStatsOperationsDatabase,
  scopedDatabaseConfiguration,
} from '@/lib/scoped-database-clients';
import { resolveRuntimeFeatureState } from '@/lib/server-feature-flags';
import { statsRateLimitSecretConfigured } from '@/lib/stat-query/operations';
import { getWorkerHealth } from '@/lib/worker-health';
import { getWorkerStartupDecision } from '@/lib/worker-startup';

export const dynamic = 'force-dynamic';

const DATABASE_TIMEOUT_MS = 3_000;

type ProbeClient = { $queryRaw: typeof prisma.$queryRaw };

interface AnalyticsBoundaryRow {
  identity_ok: boolean;
  role_attributes_ok: boolean;
  no_role_memberships: boolean;
  schema_usage_ok: boolean;
  read_only_ok: boolean;
  exact_surface_ok: boolean;
  no_write_privileges: boolean;
  no_sequence_privileges: boolean;
  no_function_privileges: boolean;
  no_schema_create: boolean;
  statement_timeout_ok: boolean;
  statement_timeout_ms: number;
}

interface OperationsBoundaryRow {
  identity_ok: boolean;
  role_attributes_ok: boolean;
  no_role_memberships: boolean;
  schema_usage_ok: boolean;
  exact_function_surface_ok: boolean;
  no_relation_privileges: boolean;
  no_sequence_privileges: boolean;
  no_schema_create: boolean;
  statement_timeout_ok: boolean;
  statement_timeout_ms: number;
}

async function runProbeQuery<Row>(client: ProbeClient, query: Prisma.Sql) {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const rows = await Promise.race([
      client.$queryRaw<Row[]>(query),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Database readiness probe timed out')),
          DATABASE_TIMEOUT_MS,
        );
      }),
    ]);
    return { rows, latencyMs: Date.now() - startedAt };
  } catch {
    return { rows: null, latencyMs: Date.now() - startedAt };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function probeDatabase(client: ProbeClient) {
  const result = await runProbeQuery<{ ready: number }>(
    client,
    Prisma.sql`SELECT 1 AS ready`,
  );
  return { ok: result.rows !== null, latencyMs: result.latencyMs };
}

async function probeAnalyticsBoundary(client: ProbeClient) {
  const result = await runProbeQuery<AnalyticsBoundaryRow>(client, Prisma.sql`
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
    ),
    relation_access AS (
      SELECT
        namespace.nspname AS schema_name,
        relation.relname AS relation_name,
        has_table_privilege(CURRENT_USER, relation.oid, 'SELECT') AS can_select,
        has_table_privilege(CURRENT_USER, relation.oid, 'INSERT')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'UPDATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'DELETE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRUNCATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRIGGER')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'REFERENCES') AS can_write
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    ),
    sequence_access AS (
      SELECT
        has_sequence_privilege(CURRENT_USER, relation.oid, 'USAGE')
          OR has_sequence_privilege(CURRENT_USER, relation.oid, 'SELECT')
          OR has_sequence_privilege(CURRENT_USER, relation.oid, 'UPDATE') AS can_access
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind = 'S'
    )
    SELECT
      CURRENT_USER = 'centrepass_analytics' AS identity_ok,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles role
        WHERE role.rolname = CURRENT_USER
          AND role.rolcanlogin
          AND NOT role.rolsuper
          AND NOT role.rolinherit
          AND NOT role.rolcreaterole
          AND NOT role.rolcreatedb
          AND NOT role.rolreplication
          AND NOT role.rolbypassrls
      ) AS role_attributes_ok,
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE member.rolname = CURRENT_USER
      ) AS no_role_memberships,
      has_schema_privilege(CURRENT_USER, 'analytics', 'USAGE') AS schema_usage_ok,
      current_setting('default_transaction_read_only', true) = 'on' AS read_only_ok,
      NOT EXISTS (
        SELECT 1
        FROM allowed
        WHERE NOT has_table_privilege(
          CURRENT_USER,
          pg_catalog.format('%I.%I', allowed.schema_name, allowed.relation_name),
          'SELECT'
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM relation_access access
        WHERE access.can_select
          AND NOT EXISTS (
            SELECT 1
            FROM allowed
            WHERE allowed.schema_name = access.schema_name
              AND allowed.relation_name = access.relation_name
          )
      ) AS exact_surface_ok,
      NOT EXISTS (
        SELECT 1 FROM relation_access access WHERE access.can_write
      ) AS no_write_privileges,
      NOT EXISTS (
        SELECT 1 FROM sequence_access access WHERE access.can_access
      ) AS no_sequence_privileges,
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc routine
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname IN ('public', 'analytics')
          AND has_function_privilege(CURRENT_USER, routine.oid, 'EXECUTE')
      ) AS no_function_privileges,
      NOT has_schema_privilege(CURRENT_USER, 'public', 'CREATE')
        AND NOT has_schema_privilege(CURRENT_USER, 'analytics', 'CREATE') AS no_schema_create,
      current_setting('statement_timeout')::INTERVAL > INTERVAL '0 seconds'
        AND current_setting('statement_timeout')::INTERVAL <= INTERVAL '2 seconds'
        AS statement_timeout_ok,
      (
        pg_catalog.extract(
          EPOCH FROM current_setting('statement_timeout')::INTERVAL
        ) * 1000
      )::INTEGER AS statement_timeout_ms
  `);
  const row = result.rows?.[0];
  const identityOk = row?.identity_ok === true;
  const roleAttributesOk = row?.role_attributes_ok === true;
  const noRoleMemberships = row?.no_role_memberships === true;
  const schemaUsageOk = row?.schema_usage_ok === true;
  const readOnly = row?.read_only_ok === true;
  const exactSurface = row?.exact_surface_ok === true;
  const noWritePrivileges = row?.no_write_privileges === true;
  const noSequencePrivileges = row?.no_sequence_privileges === true;
  const noFunctionPrivileges = row?.no_function_privileges === true;
  const noSchemaCreate = row?.no_schema_create === true;
  const statementTimeoutOk = row?.statement_timeout_ok === true;
  const statementTimeoutMs = row?.statement_timeout_ms ?? null;

  return {
    ok: identityOk
      && roleAttributesOk
      && noRoleMemberships
      && schemaUsageOk
      && readOnly
      && exactSurface
      && noWritePrivileges
      && noSequencePrivileges
      && noFunctionPrivileges
      && noSchemaCreate
      && statementTimeoutOk,
    latencyMs: result.latencyMs,
    identityOk,
    roleAttributesOk,
    noRoleMemberships,
    schemaUsageOk,
    readOnly,
    exactSurface,
    noWritePrivileges,
    noSequencePrivileges,
    noFunctionPrivileges,
    noSchemaCreate,
    statementTimeoutOk,
    statementTimeoutMs,
  };
}

async function probeOperationsBoundary(client: ProbeClient) {
  const result = await runProbeQuery<OperationsBoundaryRow>(client, Prisma.sql`
    WITH relation_access AS (
      SELECT
        has_table_privilege(CURRENT_USER, relation.oid, 'SELECT')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'INSERT')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'UPDATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'DELETE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRUNCATE')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'TRIGGER')
          OR has_table_privilege(CURRENT_USER, relation.oid, 'REFERENCES') AS can_access
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    ),
    sequence_access AS (
      SELECT
        has_sequence_privilege(CURRENT_USER, relation.oid, 'USAGE')
          OR has_sequence_privilege(CURRENT_USER, relation.oid, 'SELECT')
          OR has_sequence_privilege(CURRENT_USER, relation.oid, 'UPDATE') AS can_access
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp%'
        AND relation.relkind = 'S'
    )
    SELECT
      CURRENT_USER = 'centrepass_stats_operations' AS identity_ok,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles role
        WHERE role.rolname = CURRENT_USER
          AND role.rolcanlogin
          AND NOT role.rolsuper
          AND NOT role.rolinherit
          AND NOT role.rolcreaterole
          AND NOT role.rolcreatedb
          AND NOT role.rolreplication
          AND NOT role.rolbypassrls
      ) AS role_attributes_ok,
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members membership
        JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE member.rolname = CURRENT_USER
      ) AS no_role_memberships,
      has_schema_privilege(CURRENT_USER, 'analytics', 'USAGE') AS schema_usage_ok,
      has_function_privilege(
        CURRENT_USER,
        'analytics.reserve_stat_query_rate_limit(text)',
        'EXECUTE'
      )
      AND has_function_privilege(
        CURRENT_USER,
        'analytics.write_stat_query_telemetry(text,jsonb,text,text,integer,integer,text)',
        'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc routine
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname IN ('public', 'analytics')
          AND has_function_privilege(CURRENT_USER, routine.oid, 'EXECUTE')
          AND routine.oid NOT IN (
            'analytics.reserve_stat_query_rate_limit(text)'::regprocedure,
            'analytics.write_stat_query_telemetry(text,jsonb,text,text,integer,integer,text)'::regprocedure
          )
      ) AS exact_function_surface_ok,
      NOT EXISTS (
        SELECT 1 FROM relation_access access WHERE access.can_access
      ) AS no_relation_privileges,
      NOT EXISTS (
        SELECT 1 FROM sequence_access access WHERE access.can_access
      ) AS no_sequence_privileges,
      NOT has_schema_privilege(CURRENT_USER, 'public', 'CREATE')
        AND NOT has_schema_privilege(CURRENT_USER, 'analytics', 'CREATE') AS no_schema_create,
      current_setting('statement_timeout')::INTERVAL > INTERVAL '0 seconds'
        AND current_setting('statement_timeout')::INTERVAL <= INTERVAL '2 seconds'
        AS statement_timeout_ok,
      (
        pg_catalog.extract(
          EPOCH FROM current_setting('statement_timeout')::INTERVAL
        ) * 1000
      )::INTEGER AS statement_timeout_ms
  `);
  const row = result.rows?.[0];
  const identityOk = row?.identity_ok === true;
  const roleAttributesOk = row?.role_attributes_ok === true;
  const noRoleMemberships = row?.no_role_memberships === true;
  const schemaUsageOk = row?.schema_usage_ok === true;
  const exactFunctionSurface = row?.exact_function_surface_ok === true;
  const noRelationPrivileges = row?.no_relation_privileges === true;
  const noSequencePrivileges = row?.no_sequence_privileges === true;
  const noSchemaCreate = row?.no_schema_create === true;
  const statementTimeoutOk = row?.statement_timeout_ok === true;
  const statementTimeoutMs = row?.statement_timeout_ms ?? null;

  return {
    ok: identityOk
      && roleAttributesOk
      && noRoleMemberships
      && schemaUsageOk
      && exactFunctionSurface
      && noRelationPrivileges
      && noSequencePrivileges
      && noSchemaCreate
      && statementTimeoutOk,
    latencyMs: result.latencyMs,
    identityOk,
    roleAttributesOk,
    noRoleMemberships,
    schemaUsageOk,
    exactFunctionSurface,
    noRelationPrivileges,
    noSequencePrivileges,
    noSchemaCreate,
    statementTimeoutOk,
    statementTimeoutMs,
  };
}

export async function GET(): Promise<NextResponse> {
  const features = resolveRuntimeFeatureState();
  const scopedConfiguration = scopedDatabaseConfiguration();
  const analyticsConfigured = !features.analyticsEnabled || (
    scopedConfiguration.analyticsDatabaseUrlConfigured
    && scopedConfiguration.analyticsDatabaseUrlValid
  );
  const operationsConfigured = !features.askCentrePassEnabled || (
    scopedConfiguration.statsOperationsDatabaseUrlConfigured
    && scopedConfiguration.statsOperationsDatabaseUrlValid
  );
  const rateLimitSecretConfigured = !features.askCentrePassEnabled || statsRateLimitSecretConfigured();

  const [database, analyticsProbe, operationsProbe, workerHealth] = await Promise.all([
    probeDatabase(prisma),
    features.analyticsEnabled && analyticsConfigured
      ? probeAnalyticsBoundary(getAnalyticsDatabase())
      : Promise.resolve(null),
    features.askCentrePassEnabled && operationsConfigured
      ? probeOperationsBoundary(getStatsOperationsDatabase())
      : Promise.resolve(null),
    Promise.resolve(getWorkerHealth()),
  ]);
  const workerStartup = getWorkerStartupDecision();
  const workerIsHealthy = workerStartup.state === 'enabled' && workerHealth.isHealthy;
  const workerSatisfiesReadiness = workerStartup.state === 'enabled'
    ? workerIsHealthy
    : workerStartup.state === 'disabled' && !workerStartup.required;
  const workerState = workerStartup.state === 'enabled'
    ? workerIsHealthy ? 'healthy' : 'unhealthy'
    : workerStartup.state;
  const configurationOk = features.configurationErrors.length === 0;
  const analyticsSatisfiesReadiness = !features.analyticsEnabled
    || (analyticsConfigured && analyticsProbe?.ok === true);
  const operationsSatisfiesReadiness = !features.askCentrePassEnabled
    || (operationsConfigured && operationsProbe?.ok === true);
  const ready = database.ok
    && workerSatisfiesReadiness
    && configurationOk
    && analyticsSatisfiesReadiness
    && operationsSatisfiesReadiness
    && rateLimitSecretConfigured;

  return NextResponse.json({
    status: ready ? 'ready' : 'degraded',
    type: 'readiness',
    timestamp: new Date().toISOString(),
    checks: {
      database,
      configuration: {
        ok: configurationOk,
        errors: features.configurationErrors,
      },
      analytics: {
        ok: features.analyticsEnabled ? analyticsProbe?.ok === true : false,
        satisfiesReadiness: analyticsSatisfiesReadiness,
        state: features.analyticsEnabled
          ? analyticsProbe?.ok ? 'healthy' : analyticsConfigured ? 'unhealthy' : 'misconfigured'
          : 'disabled',
        enabled: features.analyticsEnabled,
        configured: scopedConfiguration.analyticsDatabaseUrlConfigured,
        connectionUrlValid: scopedConfiguration.analyticsDatabaseUrlValid,
        latencyMs: analyticsProbe?.latencyMs ?? null,
        identityOk: analyticsProbe?.identityOk ?? false,
        roleAttributesOk: analyticsProbe?.roleAttributesOk ?? false,
        noRoleMemberships: analyticsProbe?.noRoleMemberships ?? false,
        schemaUsageOk: analyticsProbe?.schemaUsageOk ?? false,
        readOnly: analyticsProbe?.readOnly ?? false,
        exactSurface: analyticsProbe?.exactSurface ?? false,
        noWritePrivileges: analyticsProbe?.noWritePrivileges ?? false,
        noSequencePrivileges: analyticsProbe?.noSequencePrivileges ?? false,
        noFunctionPrivileges: analyticsProbe?.noFunctionPrivileges ?? false,
        noSchemaCreate: analyticsProbe?.noSchemaCreate ?? false,
        statementTimeoutOk: analyticsProbe?.statementTimeoutOk ?? false,
        statementTimeoutMs: analyticsProbe?.statementTimeoutMs ?? null,
      },
      statsOperations: {
        ok: features.askCentrePassEnabled ? operationsProbe?.ok === true : false,
        satisfiesReadiness: operationsSatisfiesReadiness && rateLimitSecretConfigured,
        state: features.askCentrePassEnabled
          ? operationsProbe?.ok && rateLimitSecretConfigured
            ? 'healthy'
            : operationsConfigured && rateLimitSecretConfigured ? 'unhealthy' : 'misconfigured'
          : 'disabled',
        enabled: features.askCentrePassEnabled,
        configured: scopedConfiguration.statsOperationsDatabaseUrlConfigured,
        connectionUrlValid: scopedConfiguration.statsOperationsDatabaseUrlValid,
        rateLimitSecretConfigured: statsRateLimitSecretConfigured(),
        latencyMs: operationsProbe?.latencyMs ?? null,
        identityOk: operationsProbe?.identityOk ?? false,
        roleAttributesOk: operationsProbe?.roleAttributesOk ?? false,
        noRoleMemberships: operationsProbe?.noRoleMemberships ?? false,
        schemaUsageOk: operationsProbe?.schemaUsageOk ?? false,
        exactFunctionSurface: operationsProbe?.exactFunctionSurface ?? false,
        noRelationPrivileges: operationsProbe?.noRelationPrivileges ?? false,
        noSequencePrivileges: operationsProbe?.noSequencePrivileges ?? false,
        noSchemaCreate: operationsProbe?.noSchemaCreate ?? false,
        statementTimeoutOk: operationsProbe?.statementTimeoutOk ?? false,
        statementTimeoutMs: operationsProbe?.statementTimeoutMs ?? null,
      },
      worker: {
        ok: workerIsHealthy,
        satisfiesReadiness: workerSatisfiesReadiness,
        state: workerState,
        enabled: workerStartup.shouldStart,
        required: workerStartup.required,
        reason: workerStartup.reason,
        isHealthy: workerIsHealthy,
        lastPollAt: workerHealth.lastPollAt,
        lastPollStatus: workerHealth.lastPollStatus,
        currentIntervalMs: workerHealth.currentIntervalMs,
      },
    },
  }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
