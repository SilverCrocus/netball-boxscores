import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { checkDurableRateLimit } from '@/lib/stat-query/operations';

describe('checkDurableRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      $executeRaw: mocks.executeRaw,
      $queryRaw: mocks.queryRaw,
    }));
  });

  it('atomically reserves the final available request', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ count: BigInt(29) }]);
    mocks.executeRaw.mockResolvedValueOnce(1);

    await expect(checkDurableRateLimit('client-key')).resolves.toEqual({
      allowed: true,
      remaining: 0,
    });
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
  });

  it('rejects a request once the rolling limit is exhausted', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ count: BigInt(30) }]);

    await expect(checkDurableRateLimit('client-key')).resolves.toEqual({
      allowed: false,
      remaining: 0,
    });
    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });
});
