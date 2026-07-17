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
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'test');
    vi.stubEnv('ANALYTICS_FEATURES_ENABLED', 'false');
    vi.stubEnv('ASK_CENTREPASS_ENABLED', 'false');
    queryRawMock.mockReset().mockResolvedValue([{ ready: 1 }]);
    analyticsQueryRawMock.mockReset().mockResolvedValue([{ ready: 1 }]);
    operationsQueryRawMock.mockReset().mockResolvedValue([{ ready: 1 }]);
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
      isHealthy: true,
    });
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
    expect(data.checks.analytics).toMatchObject({ state: 'healthy', configured: true });
    expect(data.checks.statsOperations).toMatchObject({
      state: 'healthy',
      configured: true,
      rateLimitSecretConfigured: true,
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
