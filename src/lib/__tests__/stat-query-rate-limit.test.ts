import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/scoped-database-clients', () => ({
  getStatsOperationsDatabase: () => ({ $queryRaw: mocks.queryRaw }),
}));

import { checkDurableRateLimit } from '@/lib/stat-query/operations';

describe('checkDurableRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atomically reserves the final available request', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{
      allowed: true,
      remaining: 0,
      retry_after_seconds: 12,
    }]);

    await expect(checkDurableRateLimit('client-key')).resolves.toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 12,
    });
  });

  it('rejects a request once the rolling limit is exhausted', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{
      allowed: false,
      remaining: 0,
      retry_after_seconds: 59,
    }]);

    await expect(checkDurableRateLimit('client-key')).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 59,
    });
  });

  it('fails closed when the operations function returns no decision', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await expect(checkDurableRateLimit('client-key')).rejects.toThrow('RATE_LIMIT_DECISION_MISSING');
  });
});
