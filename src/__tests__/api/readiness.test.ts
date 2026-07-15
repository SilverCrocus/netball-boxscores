import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRawMock, workerHealthMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  workerHealthMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: queryRawMock },
}));

vi.mock('@/lib/worker-health', () => ({
  getWorkerHealth: workerHealthMock,
}));

describe('Readiness API', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKER_ENABLED', 'true');
    vi.stubEnv('DATABASE_ENVIRONMENT', 'test');
    queryRawMock.mockReset().mockResolvedValue([{ ready: 1 }]);
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
});
