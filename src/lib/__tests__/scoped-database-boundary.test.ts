import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyticsQueryRaw: vi.fn(),
  operationsQueryRaw: vi.fn(),
  configuration: vi.fn(),
}));

vi.mock('@/lib/scoped-database-clients', () => ({
  getAnalyticsDatabase: () => ({ $queryRaw: mocks.analyticsQueryRaw }),
  getStatsOperationsDatabase: () => ({ $queryRaw: mocks.operationsQueryRaw }),
  scopedDatabaseConfiguration: mocks.configuration,
}));

const PRODUCTION_REF = 'iqnhnlttvnvkwrqvnrna';
const OTHER_REF = 'xpfdjkqrbvdasjpllxnc';
const POOLER = 'aws-0-ap-southeast-2.pooler.supabase.com';

const analyticsRow = {
  identity_ok: true,
  role_attributes_ok: true,
  no_role_memberships: true,
  schema_usage_ok: true,
  read_only_ok: true,
  exact_surface_ok: true,
  no_write_privileges: true,
  no_sequence_privileges: true,
  no_function_privileges: true,
  no_schema_create: true,
  statement_timeout_ok: true,
  statement_timeout_ms: 2000,
};

const operationsRow = {
  identity_ok: true,
  role_attributes_ok: true,
  no_role_memberships: true,
  schema_usage_ok: true,
  exact_function_surface_ok: true,
  no_relation_privileges: true,
  no_sequence_privileges: true,
  no_schema_create: true,
  statement_timeout_ok: true,
  statement_timeout_ms: 2000,
};

function databaseUrl(role: string, projectRef = PRODUCTION_REF, host = POOLER): string {
  const connectionLimit = role === 'centrepass_analytics'
    ? '5'
    : role === 'centrepass_stats_operations' ? '2' : '10';
  return `postgresql://${role}.${projectRef}:secret@${host}:6543/postgres?sslmode=verify-full&pgbouncer=true&connection_limit=${connectionLimit}&pool_timeout=5`;
}

describe('scoped runtime database boundary', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', databaseUrl('postgres'));
    vi.stubEnv('ANALYTICS_DATABASE_URL', databaseUrl('centrepass_analytics'));
    vi.stubEnv(
      'STATS_OPERATIONS_DATABASE_URL',
      databaseUrl('centrepass_stats_operations'),
    );
    mocks.configuration.mockReset().mockReturnValue({
      analyticsDatabaseUrlConfigured: true,
      analyticsDatabaseUrlValid: true,
      statsOperationsDatabaseUrlConfigured: true,
      statsOperationsDatabaseUrlValid: true,
    });
    mocks.analyticsQueryRaw.mockReset().mockResolvedValue([analyticsRow]);
    mocks.operationsQueryRaw.mockReset().mockResolvedValue([operationsRow]);
    const { invalidateScopedDatabaseBoundaryCache } = await import(
      '@/lib/scoped-database-boundary'
    );
    invalidateScopedDatabaseBoundaryCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('verifies and caches a healthy role, target, and privilege contract', async () => {
    const { probeAnalyticsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );

    const first = await probeAnalyticsDatabaseBoundary();
    const second = await probeAnalyticsDatabaseBoundary();

    expect(first).toMatchObject({
      ok: true,
      targetOk: true,
      hostOk: true,
      projectRefOk: true,
      urlRoleOk: true,
      connectionParametersOk: true,
      identityOk: true,
      exactSurface: true,
      noWritePrivileges: true,
    });
    expect(second).toBe(first);
    expect(mocks.analyticsQueryRaw).toHaveBeenCalledOnce();
  });

  it('invalidates the cache explicitly and re-probes', async () => {
    const {
      invalidateScopedDatabaseBoundaryCache,
      probeAnalyticsDatabaseBoundary,
    } = await import('@/lib/scoped-database-boundary');

    await probeAnalyticsDatabaseBoundary();
    invalidateScopedDatabaseBoundaryCache('analytics');
    await probeAnalyticsDatabaseBoundary();

    expect(mocks.analyticsQueryRaw).toHaveBeenCalledTimes(2);
  });

  it('invalidates automatically when the scoped target configuration changes', async () => {
    const { probeAnalyticsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );
    expect((await probeAnalyticsDatabaseBoundary()).ok).toBe(true);

    vi.stubEnv(
      'ANALYTICS_DATABASE_URL',
      databaseUrl('centrepass_analytics', OTHER_REF),
    );
    const changed = await probeAnalyticsDatabaseBoundary();

    expect(changed).toMatchObject({ ok: false, targetOk: false, projectRefOk: false });
    expect(mocks.analyticsQueryRaw).toHaveBeenCalledOnce();
  });

  it('rejects a different project before constructing a data query', async () => {
    vi.stubEnv(
      'ANALYTICS_DATABASE_URL',
      databaseUrl('centrepass_analytics', OTHER_REF),
    );
    const { probeAnalyticsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      targetOk: false,
      hostOk: true,
      projectRefOk: false,
    });
    expect(mocks.analyticsQueryRaw).not.toHaveBeenCalled();
  });

  it('rejects a different pooler host even when the project ref is correct', async () => {
    vi.stubEnv(
      'ANALYTICS_DATABASE_URL',
      databaseUrl('centrepass_analytics', PRODUCTION_REF, 'aws-0-us-west-1.pooler.supabase.com'),
    );
    const { probeAnalyticsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      targetOk: false,
      hostOk: false,
      projectRefOk: true,
    });
    expect(mocks.analyticsQueryRaw).not.toHaveBeenCalled();
  });

  it('rejects a full-privilege URL role before probing it', async () => {
    vi.stubEnv('ANALYTICS_DATABASE_URL', databaseUrl('postgres'));
    const { probeAnalyticsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      targetOk: false,
      urlRoleOk: false,
    });
    expect(mocks.analyticsQueryRaw).not.toHaveBeenCalled();
  });

  it('rejects unsafe transaction-pool parameters before probing', async () => {
    vi.stubEnv(
      'ANALYTICS_DATABASE_URL',
      databaseUrl('centrepass_analytics').replace('connection_limit=5', 'connection_limit=50'),
    );
    const { probeAnalyticsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      targetOk: false,
      connectionParametersOk: false,
    });
    expect(mocks.analyticsQueryRaw).not.toHaveBeenCalled();
  });

  it('rejects unreviewed connection parameters instead of passing them to Prisma', async () => {
    vi.stubEnv(
      'ANALYTICS_DATABASE_URL',
      `${databaseUrl('centrepass_analytics')}&options=-c%20role%3Dpostgres`,
    );
    const { probeAnalyticsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      connectionParametersOk: false,
    });
    expect(mocks.analyticsQueryRaw).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated analytics role has excess privileges', async () => {
    mocks.analyticsQueryRaw.mockResolvedValue([{
      ...analyticsRow,
      no_write_privileges: false,
    }]);
    const {
      getVerifiedAnalyticsDatabase,
      probeAnalyticsDatabaseBoundary,
    } = await import('@/lib/scoped-database-boundary');

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      identityOk: true,
      noWritePrivileges: false,
    });
    await expect(getVerifiedAnalyticsDatabase()).rejects.toThrow(
      'analytics database boundary is unavailable',
    );
    expect(mocks.analyticsQueryRaw).toHaveBeenCalledOnce();
  });

  it('probes PostgreSQL 17 MAINTAIN and external-schema escalation for both roles', async () => {
    const {
      probeAnalyticsDatabaseBoundary,
      probeStatsOperationsDatabaseBoundary,
    } = await import('@/lib/scoped-database-boundary');

    await probeAnalyticsDatabaseBoundary();
    await probeStatsOperationsDatabaseBoundary();

    const analyticsSql = (mocks.analyticsQueryRaw.mock.calls[0]?.[0] as { sql: string }).sql;
    const operationsSql = (mocks.operationsQueryRaw.mock.calls[0]?.[0] as { sql: string }).sql;
    for (const sql of [analyticsSql, operationsSql]) {
      expect(sql).toContain(
        "has_table_privilege(CURRENT_USER, relation.oid, 'MAINTAIN')",
      );
      expect(sql).toContain(
        "namespace.nspname NOT IN ('pg_catalog', 'information_schema')",
      );
      expect(sql).toContain('OR routine.prosecdef');
      expect(sql).toContain(
        "has_schema_privilege(CURRENT_USER, namespace.oid, 'CREATE')",
      );
    }
  });

  it('fails closed on executable external SECURITY DEFINER and schema CREATE drift', async () => {
    mocks.analyticsQueryRaw.mockResolvedValue([{
      ...analyticsRow,
      no_function_privileges: false,
      no_schema_create: false,
    }]);
    mocks.operationsQueryRaw.mockResolvedValue([{
      ...operationsRow,
      exact_function_surface_ok: false,
      no_schema_create: false,
    }]);
    const {
      probeAnalyticsDatabaseBoundary,
      probeStatsOperationsDatabaseBoundary,
    } = await import('@/lib/scoped-database-boundary');

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      noFunctionPrivileges: false,
      noSchemaCreate: false,
    });
    await expect(probeStatsOperationsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      exactFunctionSurface: false,
      noSchemaCreate: false,
    });
  });

  it('fails closed when PostgreSQL 17 MAINTAIN appears in either scoped role', async () => {
    mocks.analyticsQueryRaw.mockResolvedValue([{
      ...analyticsRow,
      no_write_privileges: false,
    }]);
    mocks.operationsQueryRaw.mockResolvedValue([{
      ...operationsRow,
      no_relation_privileges: false,
    }]);
    const {
      probeAnalyticsDatabaseBoundary,
      probeStatsOperationsDatabaseBoundary,
    } = await import('@/lib/scoped-database-boundary');

    await expect(probeAnalyticsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      noWritePrivileges: false,
    });
    await expect(probeStatsOperationsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      noRelationPrivileges: false,
    });
  });

  it('fails closed and briefly caches probe failures', async () => {
    mocks.operationsQueryRaw.mockRejectedValue(new Error('database unavailable'));
    const {
      probeStatsOperationsDatabaseBoundary,
    } = await import('@/lib/scoped-database-boundary');

    const first = await probeStatsOperationsDatabaseBoundary();
    const second = await probeStatsOperationsDatabaseBoundary();

    expect(first).toMatchObject({ ok: false, targetOk: true, identityOk: false });
    expect(second).toBe(first);
    expect(mocks.operationsQueryRaw).toHaveBeenCalledOnce();
  });

  it('rejects operations access when any relation privilege is present', async () => {
    mocks.operationsQueryRaw.mockResolvedValue([{
      ...operationsRow,
      no_relation_privileges: false,
    }]);
    const { probeStatsOperationsDatabaseBoundary } = await import(
      '@/lib/scoped-database-boundary'
    );

    await expect(probeStatsOperationsDatabaseBoundary()).resolves.toMatchObject({
      ok: false,
      identityOk: true,
      noRelationPrivileges: false,
    });
  });
});
