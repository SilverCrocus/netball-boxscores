import { createHash } from 'node:crypto';
import { readAnalyticsSnapshotEpoch } from '@/lib/analytics/repository';

/**
 * The namespace is part of the cache contract. Bump it whenever a deployed
 * calculator or its serialized request contract can no longer consume a
 * previously calculated snapshot.
 */
export const ANALYTICS_SNAPSHOT_CACHE_NAMESPACE = 'centrepass-analytics-snapshots.v1';
export const ANALYTICS_CACHE_EPOCH_CONTRACT_VERSION = 'analytics-cache-epoch.v1';

const MAX_CACHE_INPUT_BYTES = 32_768;
const CACHE_EPOCH_PATTERN = /^[1-9]\d{0,18}$/u;

/**
 * Reads the durable global analytics epoch. A missing, malformed, or
 * unavailable epoch is deliberately represented as null so callers can fall
 * back to the source calculation rather than serving an unverified value.
 */
export async function readAnalyticsCacheEpoch(): Promise<string | null> {
  try {
    const { revision, contractVersion } = await readAnalyticsSnapshotEpoch();
    if (contractVersion !== ANALYTICS_CACHE_EPOCH_CONTRACT_VERSION) return null;
    if (typeof revision !== 'bigint' || revision < BigInt(1)) return null;
    const serialized = revision.toString();
    return CACHE_EPOCH_PATTERN.test(serialized) ? serialized : null;
  } catch {
    return null;
  }
}

/**
 * Hashes a bounded, canonical cache payload so request identifiers never
 * become unbounded Next.js cache-key material. The payload remains complete:
 * callers must include every input that affects the calculation.
 */
export function buildAnalyticsSnapshotCacheKey(
  snapshotType: string,
  epoch: string,
  input: unknown,
): string | null {
  if (!/^[a-z0-9-]{1,64}$/u.test(snapshotType) || !CACHE_EPOCH_PATTERN.test(epoch)) return null;

  let serialized: string;
  try {
    serialized = JSON.stringify({
      namespace: ANALYTICS_SNAPSHOT_CACHE_NAMESPACE,
      snapshotType,
      epoch,
      input,
    });
  } catch {
    return null;
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAX_CACHE_INPUT_BYTES) return null;
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
