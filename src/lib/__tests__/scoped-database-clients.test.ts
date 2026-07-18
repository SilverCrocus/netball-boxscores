import { afterEach, describe, expect, it, vi } from 'vitest';

const { prismaConstructor } = vi.hoisted(() => ({ prismaConstructor: vi.fn() }));

vi.mock('@prisma/client', () => ({
  PrismaClient: function MockPrismaClient(options: unknown) {
    prismaConstructor(options);
    return { options };
  },
}));

describe('scoped database clients', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as typeof globalThis & { analyticsDatabase?: unknown }).analyticsDatabase;
    delete (globalThis as typeof globalThis & { statsOperationsDatabase?: unknown }).statsOperationsDatabase;
    prismaConstructor.mockReset();
    vi.resetModules();
  });

  it('does not construct or fall back to DATABASE_URL at module import time', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://write-capable.example/database');
    vi.stubEnv('ANALYTICS_DATABASE_URL', '');
    const clients = await import('@/lib/scoped-database-clients');

    expect(prismaConstructor).not.toHaveBeenCalled();
    expect(() => clients.getAnalyticsDatabase()).toThrow('ANALYTICS_DATABASE_URL is required');
    expect(prismaConstructor).not.toHaveBeenCalled();
  });

  it('creates and reuses independent lazy clients from their dedicated URLs', async () => {
    vi.stubEnv('ANALYTICS_DATABASE_URL', 'postgresql://analytics.example/database');
    vi.stubEnv('STATS_OPERATIONS_DATABASE_URL', 'postgresql://operations.example/database');
    const clients = await import('@/lib/scoped-database-clients');

    expect(clients.getAnalyticsDatabase()).toBe(clients.getAnalyticsDatabase());
    expect(clients.getStatsOperationsDatabase()).toBe(clients.getStatsOperationsDatabase());
    expect(prismaConstructor).toHaveBeenNthCalledWith(1, {
      datasourceUrl: 'postgresql://analytics.example/database?pgbouncer=true&connection_limit=5&pool_timeout=5',
    });
    expect(prismaConstructor).toHaveBeenNthCalledWith(2, {
      datasourceUrl: 'postgresql://operations.example/database?pgbouncer=true&connection_limit=2&pool_timeout=5',
    });
  });

  it('overrides unsafe runtime pool parameters and reports malformed URLs', async () => {
    vi.stubEnv(
      'ANALYTICS_DATABASE_URL',
      'postgresql://analytics.example/database?pgbouncer=false&connection_limit=99&pool_timeout=60',
    );
    vi.stubEnv('STATS_OPERATIONS_DATABASE_URL', 'not-a-database-url');
    const clients = await import('@/lib/scoped-database-clients');

    clients.getAnalyticsDatabase();
    expect(prismaConstructor).toHaveBeenCalledWith({
      datasourceUrl: 'postgresql://analytics.example/database?pgbouncer=true&connection_limit=5&pool_timeout=5',
    });
    expect(clients.scopedDatabaseConfiguration()).toEqual({
      analyticsDatabaseUrlConfigured: true,
      analyticsDatabaseUrlValid: true,
      statsOperationsDatabaseUrlConfigured: true,
      statsOperationsDatabaseUrlValid: false,
    });
    expect(() => clients.getStatsOperationsDatabase()).toThrow(
      'STATS_OPERATIONS_DATABASE_URL must be a valid PostgreSQL connection URL',
    );
  });
});
