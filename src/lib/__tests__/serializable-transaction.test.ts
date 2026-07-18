import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: { $transaction: mockTransaction },
}));

import {
  runSerializableTransaction,
  SERIALIZABLE_TRANSACTION_OPTIONS,
} from '@/lib/serializable-transaction';

describe('runSerializableTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses bounded production-safe serializable transaction options', async () => {
    mockTransaction.mockImplementationOnce(async (operation) => operation({ tx: true }));

    await expect(runSerializableTransaction(async () => 'committed')).resolves.toBe('committed');

    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      SERIALIZABLE_TRANSACTION_OPTIONS,
    );
    expect(SERIALIZABLE_TRANSACTION_OPTIONS).toEqual({
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 15_000,
    });
  });

  it('retries a serialization conflict from a fresh transaction', async () => {
    mockTransaction
      .mockImplementationOnce(async (operation) => {
        await operation({ attempt: 1 });
        throw Object.assign(new Error('write conflict'), { code: 'P2034' });
      })
      .mockImplementationOnce(async (operation) => operation({ tx: true }));
    const operation = vi.fn().mockResolvedValue('committed');

    await expect(runSerializableTransaction(operation)).resolves.toBe('committed');

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-serialization failure', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(runSerializableTransaction(async () => 'never')).rejects.toThrow(
      'database unavailable',
    );
    expect(mockTransaction).toHaveBeenCalledOnce();
  });
});
