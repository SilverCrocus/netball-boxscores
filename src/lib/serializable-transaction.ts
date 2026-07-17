import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Live poll and standings writes can overlap across worker instances. Keep the
 * transaction long enough for a full match snapshot, while still failing
 * quickly enough for the next poll to recover.
 */
export const SERIALIZABLE_TRANSACTION_OPTIONS = {
  isolationLevel: 'Serializable' as const,
  maxWait: 5_000,
  timeout: 15_000,
};

const MAX_SERIALIZATION_ATTEMPTS = 3;

function isSerializationConflict(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2034';
}

export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(operation, SERIALIZABLE_TRANSACTION_OPTIONS);
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new Error('Serializable transaction retry loop exhausted unexpectedly');
}
