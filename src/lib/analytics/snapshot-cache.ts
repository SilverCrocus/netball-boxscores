import { recordCacheSnapshotMeasurement } from '@/lib/server-timing';

/**
 * Next's default cache handler rejects entries at roughly two MiB. Keep the
 * analytics snapshots materially below that boundary so a deployment cannot
 * turn a large result into an opaque cache-layer failure.
 */
export const NEXT_CACHE_ENTRY_LIMIT_BYTES = 2 * 1024 * 1024;
export const ANALYTICS_SNAPSHOT_CACHE_SAFE_LIMIT_BYTES = Math.floor(
  NEXT_CACHE_ENTRY_LIMIT_BYTES * 0.75,
);

export interface SnapshotCacheCounts {
  rowCount: number;
  resultCount: number;
}

export class SnapshotCacheTooLargeError<T> extends Error {
  readonly cacheName: string;
  readonly bytes: number;
  readonly value: T;

  constructor(cacheName: string, bytes: number, value: T) {
    super(`${cacheName} snapshot exceeds the safe cache entry size`);
    this.name = 'SnapshotCacheTooLargeError';
    this.cacheName = cacheName;
    this.bytes = bytes;
    this.value = value;
  }
}

const inFlightSnapshots = new Map<string, Promise<unknown>>();

/**
 * Coalesces concurrent calls for one cache identity within this process.
 * Epoch is explicit here even though it is also part of the hashed cache key:
 * a rotated epoch must never share a flight with the previous epoch.
 */
export function runAnalyticsSnapshotSingleFlight<T>(
  cacheName: string,
  epoch: string,
  cacheKey: string,
  loader: () => Promise<T>,
): Promise<T> {
  const identity = `${cacheName}\u0000${epoch}\u0000${cacheKey}`;
  const existing = inFlightSnapshots.get(identity);
  if (existing) return existing as Promise<T>;

  const flight = Promise.resolve().then(loader);
  inFlightSnapshots.set(identity, flight);
  void flight.then(
    () => {
      if (inFlightSnapshots.get(identity) === flight) inFlightSnapshots.delete(identity);
    },
    () => {
      if (inFlightSnapshots.get(identity) === flight) inFlightSnapshots.delete(identity);
    },
  );
  return flight;
}

function serializedByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Snapshot cache DTO is not JSON serializable');
  return new TextEncoder().encode(serialized).byteLength;
}

/**
 * Measures the exact JSON representation that Next's cache boundary stores,
 * emits only bounded operational metadata, and rejects oversized DTOs before
 * they reach the cache layer.
 */
export function assertAnalyticsSnapshotCacheSize<T>(
  cacheName: string,
  value: T,
  counts: SnapshotCacheCounts,
): T {
  const before = typeof process.memoryUsage === 'function' ? process.memoryUsage() : null;
  const bytes = serializedByteLength(value);
  const after = typeof process.memoryUsage === 'function' ? process.memoryUsage() : null;
  recordCacheSnapshotMeasurement(cacheName, {
    rowCount: counts.rowCount,
    resultCount: counts.resultCount,
    serializedBytes: bytes,
    rssBeforeBytes: before?.rss ?? null,
    rssAfterBytes: after?.rss ?? null,
    rssDeltaBytes: before && after ? after.rss - before.rss : null,
    heapUsedBeforeBytes: before?.heapUsed ?? null,
    heapUsedAfterBytes: after?.heapUsed ?? null,
    heapUsedDeltaBytes: before && after ? after.heapUsed - before.heapUsed : null,
  });
  if (bytes > ANALYTICS_SNAPSHOT_CACHE_SAFE_LIMIT_BYTES) {
    // Reject the cache operation so Next does not persist the oversized DTO,
    // but carry the computed value back to the caller to avoid a second heavy
    // facts/directory/calculation pass.
    throw new SnapshotCacheTooLargeError(cacheName, bytes, value);
  }
  return value;
}

export function serializedAnalyticsSnapshotBytes(value: unknown): number {
  return serializedByteLength(value);
}
