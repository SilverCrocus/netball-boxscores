import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { readAnalyticsRevision } from '@/lib/analytics/repository';
import { getVerifiedStatsOperationsDatabase } from '@/lib/scoped-database-boundary';
import { askCentrePassEnabled } from '@/lib/server-feature-flags';
import { normalizeStatQuestion } from '@/lib/stat-query/normalize';
import { persistQueryTelemetry } from '@/lib/stat-query/telemetry';
import type { ParseResult, QuerySpecV1 } from '@/lib/stat-query/types';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 100;
const resultCache = new Map<string, { expiresAt: number; value: unknown }>();

function validRateSecret(secret: string | undefined): secret is string {
  const value = secret?.trim() ?? '';
  return value.length >= 32 && !/(generate|replace|change[- _]?me|example|placeholder)/i.test(value);
}

function rateSecret(): string {
  const secret = process.env.STATS_RATE_LIMIT_SECRET?.trim();
  if (validRateSecret(secret)) return secret;
  if (process.env.NODE_ENV === 'production' || askCentrePassEnabled()) {
    throw new Error('STATS_RATE_LIMIT_SECRET must be a non-placeholder secret of at least 32 characters');
  }
  return 'centrepass-local-rate-limit-only-for-tests-and-disabled-development';
}

export function statsRateLimitSecretConfigured(): boolean {
  return validRateSecret(process.env.STATS_RATE_LIMIT_SECRET);
}

export function questionHash(question: string): string {
  return createHmac('sha256', rateSecret())
    .update(`question.v1:${normalizeStatQuestion(question)}`)
    .digest('hex');
}

export function rateLimitKey(identifier: string, now = new Date()): string {
  const dailyBucket = now.toISOString().slice(0, 10);
  return createHmac('sha256', rateSecret())
    .update(`rate-limit.v1:${dailyBucket}:${identifier}`)
    .digest('hex');
}

export async function checkDurableRateLimit(keyHash: string): Promise<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}> {
  const rows = await (await getVerifiedStatsOperationsDatabase()).$queryRaw<Array<{
    allowed: boolean;
    remaining: number;
    retry_after_seconds: number;
  }>>(Prisma.sql`
    SELECT allowed, remaining, retry_after_seconds
    FROM analytics.reserve_stat_query_rate_limit(${keyHash})
  `);
  const decision = rows[0];
  if (!decision) throw new Error('RATE_LIMIT_DECISION_MISSING');
  return {
    allowed: decision.allowed,
    remaining: decision.remaining,
    retryAfterSeconds: decision.retry_after_seconds,
  };
}

export async function analyticsRevision(): Promise<string> {
  const revision = await readAnalyticsRevision();
  return `${revision.revision}:${revision.invalidatedAt?.toISOString() ?? 'none'}`;
}

export function cacheKey(spec: QuerySpecV1, revision: string): string {
  return createHash('sha256').update(JSON.stringify({ spec, revision })).digest('hex');
}

export function getCachedResult<T>(key: string): T | null {
  const cached = resultCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return null;
  }
  return cached.value as T;
}

export function setCachedResult(key: string, value: unknown): void {
  if (resultCache.size >= CACHE_MAX) resultCache.delete(resultCache.keys().next().value!);
  resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

export async function withStatQueryTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('STAT_QUERY_TIMEOUT')), timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function writeQueryTelemetry(input: {
  question: string;
  parseResult: ParseResult;
  resultStatus: string;
  resultCount: number;
  latencyMs: number;
  errorCode?: string;
}): Promise<void> {
  await persistQueryTelemetry(await getVerifiedStatsOperationsDatabase(), {
    ...input,
    questionHash: questionHash(input.question),
  });
}
