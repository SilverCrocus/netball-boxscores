import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryRawMock,
  analyticsQueryRawMock,
  operationsQueryRawMock,
  scopedConfigurationMock,
  secretConfiguredMock,
  workerHealthMock,
} = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  analyticsQueryRawMock: vi.fn(),
  operationsQueryRawMock: vi.fn(),
  scopedConfigurationMock: vi.fn(),
  secretConfiguredMock: vi.fn(),
  workerHealthMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: queryRawMock },
}));

vi.mock('@/lib/worker-health', () => ({
  getWorkerHealth: workerHealthMock,
}));

vi.mock('@/lib/scoped-database-clients', () => ({
  getAnalyticsDatabase: () => ({ $queryRaw: analyticsQueryRawMock }),
  getStatsOperationsDatabase: () => ({ $queryRaw: operationsQueryRawMock }),
  scopedDatabaseConfiguration: scopedConfigurationMock,
}));

vi.mock('@/lib/stat-query/operations', () => ({
  statsRateLimitSecretConfigured: secretConfiguredMock,
}));

describe('Readiness API', () => {
  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'test');
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'false');
    vi.stubEnv('ASK_CENTREPASS_ENABLED', 'false');
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres@localhost:5432/centrepass');
    vi.stubEnv(
      'ANALYTICS_DATABASE_URL',
      'postgresql://centrepass_analytics@localhost:5432/centrepass',
    );
    vi.stubEnv(
      'STATS_OPERATIONS_DATABASE_URL',
      'postgresql://centrepass_stats_operations@localhost:5432/centrepass',
    );
    queryRawMock.mockReset().mockResolvedValue([{ ready: 1 }]);
    analyticsQueryRawMock.mockReset().mockResolvedValue([{
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
    }]);
    operationsQueryRawMock.mockReset().mockResolvedValue([{
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
    }]);
    scopedConfigurationMock.mockReset().mockReturnValue({
      analyticsDatabaseUrlConfigured: false,
      analyticsDatabaseUrlValid: false,
      statsOperationsDatabaseUrlConfigured: false,
      statsOperationsDatabaseUrlValid: false,
    });
    secretConfiguredMock.mockReset().mockReturnValue(false);
    workerHealthMock.mockReset().mockReturnValue({
      lastPollAt: '2026-07-12T00:00:00.000Z',
      lastPollStatus: 'success',
      currentIntervalMs: 30_000,
      matchesProcessed: 2,
      pollsSinceStartup: 3,
      uptimeMs: 60_000,
      pollInProgress: false,
      pollStartedAt: null,
      pollElapsedMs: null,
      maxActivePollMs: 180_000,
      isHealthy: true,
    });
    const { invalidateScopedDatabaseBoundaryCache } = await import(
      '@/lib/scoped-database-boundary'
    );
    invalidateScopedDatabaseBoundaryCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns ready only after probing both the database and worker freshness', async () => {
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(queryRawMock).toHaveBeenCalledOnce();
    expect(workerHealthMock).toHaveBeenCalledOnce();
    expect(data).toMatchObject({
      status: 'ready',
      type: 'readiness',
      checks: {
        database: { ok: true },
        analytics: { state: 'disabled', satisfiesReadiness: true },
        statsOperations: { state: 'disabled', satisfiesReadiness: true },
        worker: {
          ok: true,
          satisfiesReadiness: true,
          state: 'healthy',
          enabled: true,
          required: true,
          isHealthy: true,
          lastPollStatus: 'success',
          pollInProgress: false,
          pollStartedAt: null,
        },
      },
    });
  });

  it('returns 503 when the database probe fails', async () => {
    queryRawMock.mockRejectedValue(new Error('database unavailable'));
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('degraded');
    expect(data.checks.database.ok).toBe(false);
  });

  it('returns 503 when worker polling is stale', async () => {
    workerHealthMock.mockReturnValue({
      lastPollAt: '2026-07-11T00:00:00.000Z',
      lastPollStatus: 'success',
      currentIntervalMs: 30_000,
      matchesProcessed: 0,
      pollsSinceStartup: 1,
      uptimeMs: 60_000,
      pollInProgress: false,
      pollStartedAt: null,
      pollElapsedMs: null,
      maxActivePollMs: 180_000,
      isHealthy: false,
    });
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.checks.worker).toMatchObject({
      ok: false,
      satisfiesReadiness: false,
      state: 'unhealthy',
      enabled: true,
      required: true,
      isHealthy: false,
    });
  });

  it('reports a disabled development worker as not required, not healthy', async () => {
    vi.stubEnv('WORKER_ENABLED', 'false');
    workerHealthMock.mockReturnValue({
      lastPollAt: '2026-07-12T00:00:00.000Z',
      lastPollStatus: 'success',
      currentIntervalMs: 30_000,
      matchesProcessed: 2,
      pollsSinceStartup: 3,
      uptimeMs: 60_000,
      pollInProgress: false,
      pollStartedAt: null,
      pollElapsedMs: null,
      maxActivePollMs: 180_000,
      isHealthy: true,
    });
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ready');
    expect(data.checks.worker).toMatchObject({
      ok: false,
      satisfiesReadiness: true,
      state: 'disabled',
      enabled: false,
      required: false,
      isHealthy: false,
      lastPollStatus: 'success',
    });
  });

  it('returns 503 when the required production worker is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WORKER_ENABLED', 'false');
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.checks.worker).toMatchObject({
      ok: false,
      satisfiesReadiness: false,
      state: 'disabled',
      enabled: false,
      required: true,
    });
  });

  it('probes both scoped credentials when analytics and Ask CentrePass are enabled', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'true');
    vi.stubEnv('ASK_CENTREPASS_ENABLED', 'true');
    scopedConfigurationMock.mockReturnValue({
      analyticsDatabaseUrlConfigured: true,
      analyticsDatabaseUrlValid: true,
      statsOperationsDatabaseUrlConfigured: true,
      statsOperationsDatabaseUrlValid: true,
    });
    secretConfiguredMock.mockReturnValue(true);
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(analyticsQueryRawMock).toHaveBeenCalledOnce();
    expect(operationsQueryRawMock).toHaveBeenCalledOnce();
    expect(data.checks.analytics).toMatchObject({
      state: 'healthy',
      configured: true,
      identityOk: true,
      roleAttributesOk: true,
      noRoleMemberships: true,
      schemaUsageOk: true,
      readOnly: true,
      exactSurface: true,
      noWritePrivileges: true,
      noSequencePrivileges: true,
      noFunctionPrivileges: true,
      noSchemaCreate: true,
      statementTimeoutOk: true,
      statementTimeoutMs: 2000,
    });
    expect(data.checks.statsOperations).toMatchObject({
      state: 'healthy',
      configured: true,
      rateLimitSecretConfigured: true,
      identityOk: true,
      roleAttributesOk: true,
      noRoleMemberships: true,
      schemaUsageOk: true,
      exactFunctionSurface: true,
      noRelationPrivileges: true,
      noSequencePrivileges: true,
      noSchemaCreate: true,
      statementTimeoutOk: true,
      statementTimeoutMs: 2000,
    });
  });

  it('fails readiness when the analytics URL authenticates as a writer or wrong role', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'true');
    scopedConfigurationMock.mockReturnValue({
      analyticsDatabaseUrlConfigured: true,
      analyticsDatabaseUrlValid: true,
      statsOperationsDatabaseUrlConfigured: false,
      statsOperationsDatabaseUrlValid: false,
    });
    analyticsQueryRawMock.mockResolvedValue([{
      identity_ok: false,
      role_attributes_ok: false,
      no_role_memberships: false,
      schema_usage_ok: false,
      read_only_ok: false,
      exact_surface_ok: false,
      no_write_privileges: false,
      no_sequence_privileges: false,
      no_function_privileges: false,
      no_schema_create: false,
      statement_timeout_ok: false,
      statement_timeout_ms: 120000,
    }]);
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.checks.analytics).toMatchObject({
      state: 'unhealthy',
      identityOk: false,
      roleAttributesOk: false,
      noRoleMemberships: false,
      schemaUsageOk: false,
      readOnly: false,
      exactSurface: false,
      noWritePrivileges: false,
      noSequencePrivileges: false,
      noFunctionPrivileges: false,
      noSchemaCreate: false,
      statementTimeoutOk: false,
      statementTimeoutMs: 120000,
    });
  });

  it('fails readiness when the operations URL has relation access or the wrong role', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'true');
    vi.stubEnv('ASK_CENTREPASS_ENABLED', 'true');
    scopedConfigurationMock.mockReturnValue({
      analyticsDatabaseUrlConfigured: true,
      analyticsDatabaseUrlValid: true,
      statsOperationsDatabaseUrlConfigured: true,
      statsOperationsDatabaseUrlValid: true,
    });
    secretConfiguredMock.mockReturnValue(true);
    operationsQueryRawMock.mockResolvedValue([{
      identity_ok: false,
      role_attributes_ok: false,
      no_role_memberships: false,
      schema_usage_ok: false,
      exact_function_surface_ok: false,
      no_relation_privileges: false,
      no_sequence_privileges: false,
      no_schema_create: false,
      statement_timeout_ok: false,
      statement_timeout_ms: 120000,
    }]);
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.checks.statsOperations).toMatchObject({
      state: 'unhealthy',
      identityOk: false,
      roleAttributesOk: false,
      noRoleMemberships: false,
      schemaUsageOk: false,
      exactFunctionSurface: false,
      noRelationPrivileges: false,
      noSequencePrivileges: false,
      noSchemaCreate: false,
      statementTimeoutOk: false,
      statementTimeoutMs: 120000,
    });
  });

  it('fails readiness when a scoped database role has a statement timeout above two seconds', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'true');
    scopedConfigurationMock.mockReturnValue({
      analyticsDatabaseUrlConfigured: true,
      analyticsDatabaseUrlValid: true,
      statsOperationsDatabaseUrlConfigured: false,
      statsOperationsDatabaseUrlValid: false,
    });
    analyticsQueryRawMock.mockResolvedValue([{
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
      statement_timeout_ok: false,
      statement_timeout_ms: 3000,
    }]);
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.checks.analytics).toMatchObject({
      state: 'unhealthy',
      statementTimeoutOk: false,
      statementTimeoutMs: 3000,
    });
  });

  it('fails readiness without constructing a scoped client when a configured URL is malformed', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'true');
    scopedConfigurationMock.mockReturnValue({
      analyticsDatabaseUrlConfigured: true,
      analyticsDatabaseUrlValid: false,
      statsOperationsDatabaseUrlConfigured: false,
      statsOperationsDatabaseUrlValid: false,
    });
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(analyticsQueryRawMock).not.toHaveBeenCalled();
    expect(data.checks.analytics).toMatchObject({
      state: 'misconfigured',
      configured: true,
      connectionUrlValid: false,
    });
  });

  it('fails readiness without constructing a scoped client when an enabled credential is missing', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'true');
    vi.stubEnv('ASK_CENTREPASS_ENABLED', 'false');
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(analyticsQueryRawMock).not.toHaveBeenCalled();
    expect(data.checks.analytics).toMatchObject({
      state: 'misconfigured',
      enabled: true,
      configured: false,
    });
  });

  it('reports the Ask dependency misconfiguration without exposing secrets', async () => {
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'false');
    vi.stubEnv('ASK_CENTREPASS_ENABLED', 'true');
    const { GET } = await import('@/app/api/readiness/route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.checks.configuration).toMatchObject({ ok: false });
    expect(JSON.stringify(data)).toContain('ASK_CENTREPASS_ENABLED requires ANALYTICS_FEATURES_ENABLED');
    expect(JSON.stringify(data)).not.toContain('DATABASE_URL=');
  });
});
