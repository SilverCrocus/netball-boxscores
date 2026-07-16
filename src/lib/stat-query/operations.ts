import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizeStatQuestion } from '@/lib/stat-query/normalize';
import type { ParseResult, QuerySpecV1 } from '@/lib/stat-query/types';

const RATE_LIMIT = 30;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 100;
const resultCache = new Map<string, { expiresAt: number; value: unknown }>();

function rateSecret(): string {
  const secret = process.env.STATS_RATE_LIMIT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('STATS_RATE_LIMIT_SECRET is required in production');
  return 'centrepass-local-rate-limit';
}
export function questionHash(question: string): string {
  return createHash('sha256').update(normalizeStatQuestion(question)).digest('hex');
}

export function rateLimitKey(identifier: string, now = new Date()): string {
  const dailyBucket = now.toISOString().slice(0, 10);
  return createHmac('sha256', rateSecret()).update(`${dailyBucket}:${identifier}`).digest('hex');
}

export async function checkDurableRateLimit(keyHash: string): Promise<{ allowed: boolean; remaining: number }> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`
      WITH rate_limit_lock AS (
        SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))
      )
      SELECT 1::INTEGER AS locked FROM rate_limit_lock
    `);
    const rows = await transaction.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count
      FROM analytics.query_telemetry
      WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '1 minute'
        AND result_status = 'RATE_LIMIT_RESERVATION'
        AND query_spec ->> 'rateLimitKeyHash' = ${keyHash}
    `);
    const count = Number(rows[0]?.count ?? 0);
    if (count >= RATE_LIMIT) return { allowed: false, remaining: 0 };

    const reservation = JSON.stringify({ rateLimitKeyHash: keyHash });
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO analytics.query_telemetry
        (question_hash, query_spec, parser_version, result_status, result_count, latency_ms)
      VALUES
        ('rate-limit-reservation', ${reservation}::JSONB, 'rate-limit.v1', 'RATE_LIMIT_RESERVATION', 0, 0)
    `);
    return { allowed: true, remaining: Math.max(0, RATE_LIMIT - count - 1) };
  });
}

export async function analyticsRevision(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ revision: bigint; invalidated_at: Date | null }>>(Prisma.sql`
    SELECT COALESCE(MAX(revision), 0)::BIGINT AS revision, MAX(invalidated_at) AS invalidated_at
    FROM analytics.cache_invalidation
  `);
  return `${rows[0]?.revision ?? 0}:${rows[0]?.invalidated_at?.toISOString() ?? 'none'}`;
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
  const querySpec = input.parseResult.status === 'READY' ? input.parseResult.spec : null;
  const payload = querySpec ? JSON.stringify(querySpec) : null;
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO analytics.query_telemetry
      (question_hash, query_spec, parser_version, result_status, result_count, latency_ms, error_code)
    VALUES
      (${questionHash(input.question)}, ${payload}::JSONB, ${input.parseResult.parserVersion},
       ${input.resultStatus}, ${input.resultCount}, ${input.latencyMs}, ${input.errorCode ?? null})
  `);
}
