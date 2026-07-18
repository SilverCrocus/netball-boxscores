import { createHash, randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { persistQueryTelemetry } from '@/lib/stat-query/telemetry';
import { RULE_PARSER_VERSION } from '@/lib/stat-query/types';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

const EXPECTED_ROLLBACK = 'EXPECTED_PREVIEW_TELEMETRY_ROLLBACK';

function previewRuntimeDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.hostname.endsWith('.pooler.supabase.com')) {
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('pool_timeout', '10');
  }
  return url.toString();
}

const prisma = new PrismaClient({ datasourceUrl: previewRuntimeDatabaseUrl() });

interface AnalyticsStateRow {
  rankingSnapshotCount: bigint;
  recordEntryCount: bigint;
  queryTelemetryCount: bigint;
  cacheInvalidationCount: bigint;
  queryRateLimitBucketCount: bigint;
}

interface TelemetryRow {
  questionHash: string;
  querySpec: Prisma.JsonValue | null;
  parserVersion: string;
  resultStatus: string;
  resultCount: number;
  latencyMs: number;
  errorCode: string | null;
}

type QueryDatabase = Pick<Prisma.TransactionClient, '$queryRaw'>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Preview telemetry verification failed: ${message}`);
  }
}

async function readAnalyticsState(database: QueryDatabase): Promise<AnalyticsStateRow> {
  const rows = await database.$queryRaw<AnalyticsStateRow[]>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM analytics.ranking_snapshot)::BIGINT AS "rankingSnapshotCount",
      (SELECT COUNT(*) FROM analytics.record_entry)::BIGINT AS "recordEntryCount",
      (SELECT COUNT(*) FROM analytics.query_telemetry)::BIGINT AS "queryTelemetryCount",
      (SELECT COUNT(*) FROM analytics.cache_invalidation)::BIGINT AS "cacheInvalidationCount",
      (SELECT COUNT(*) FROM analytics.query_rate_limit_bucket)::BIGINT AS "queryRateLimitBucketCount"
  `);
  const state = rows[0];
  invariant(state, 'analytics state query returned no row');
  return state;
}

function sameState(left: AnalyticsStateRow, right: AnalyticsStateRow): boolean {
  return Object.keys(left).every((key) => (
    left[key as keyof AnalyticsStateRow] === right[key as keyof AnalyticsStateRow]
  ));
}

function verifyOnlyTelemetryIncremented(
  before: AnalyticsStateRow,
  after: AnalyticsStateRow,
): void {
  invariant(
    after.queryTelemetryCount === before.queryTelemetryCount + BigInt(1),
    'one invocation must add exactly one telemetry row',
  );
  invariant(
    after.rankingSnapshotCount === before.rankingSnapshotCount,
    'ranking snapshots changed during telemetry verification',
  );
  invariant(
    after.recordEntryCount === before.recordEntryCount,
    'record entries changed during telemetry verification',
  );
  invariant(
    after.cacheInvalidationCount === before.cacheInvalidationCount,
    'cache invalidations changed during telemetry verification',
  );
  invariant(
    after.queryRateLimitBucketCount === before.queryRateLimitBucketCount,
    'rate-limit buckets changed during telemetry verification',
  );
}

async function main() {
  const target = verifyPreviewDatabaseTarget();
  const expectedQuestionHash = createHash('sha256')
    .update(randomBytes(32))
    .digest('hex');
  const baseline = await readAnalyticsState(prisma);
  let observedIncrement = false;

  try {
    await prisma.$transaction(async (transaction) => {
      const before = await readAnalyticsState(transaction);
      invariant(sameState(before, baseline), 'analytics state changed before the invocation');

      const existing = await transaction.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::BIGINT AS count
        FROM analytics.query_telemetry
        WHERE question_hash = ${expectedQuestionHash}
      `);
      invariant(existing[0]?.count === BigInt(0), 'synthetic telemetry marker already exists');

      await persistQueryTelemetry(transaction, {
        questionHash: expectedQuestionHash,
        parseResult: {
          status: 'UNSUPPORTED',
          code: 'PREVIEW_TELEMETRY_REHEARSAL',
          message: 'Synthetic preview-only telemetry verification.',
          parserVersion: RULE_PARSER_VERSION,
        },
        resultStatus: 'UNSUPPORTED',
        resultCount: 0,
        latencyMs: 7,
        errorCode: 'PREVIEW_TELEMETRY_REHEARSAL',
      });

      const after = await readAnalyticsState(transaction);
      verifyOnlyTelemetryIncremented(before, after);

      const rows = await transaction.$queryRaw<TelemetryRow[]>(Prisma.sql`
        SELECT
          question_hash AS "questionHash",
          query_spec AS "querySpec",
          parser_version AS "parserVersion",
          result_status AS "resultStatus",
          result_count AS "resultCount",
          latency_ms AS "latencyMs",
          error_code AS "errorCode"
        FROM analytics.query_telemetry
        WHERE question_hash = ${expectedQuestionHash}
      `);
      invariant(rows.length === 1, `expected one synthetic row, found ${rows.length}`);
      invariant(rows[0]?.querySpec === null, 'unsupported query must not store a query spec');
      invariant(rows[0]?.parserVersion === RULE_PARSER_VERSION, 'parser version mismatch');
      invariant(rows[0]?.resultStatus === 'UNSUPPORTED', 'result status mismatch');
      invariant(rows[0]?.resultCount === 0, 'result count mismatch');
      invariant(rows[0]?.latencyMs === 7, 'latency mismatch');
      invariant(
        rows[0]?.errorCode === 'PREVIEW_TELEMETRY_REHEARSAL',
        'error code mismatch',
      );
      observedIncrement = true;

      throw new Error(EXPECTED_ROLLBACK);
    });
  } catch (error) {
    invariant(
      error instanceof Error && error.message === EXPECTED_ROLLBACK,
      error instanceof Error ? error.message : 'unexpected non-Error failure',
    );
  }

  invariant(observedIncrement, 'the transactional increment was not observed');
  const restored = await readAnalyticsState(prisma);
  invariant(sameState(restored, baseline), 'analytics state was not restored after rollback');
  const remaining = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::BIGINT AS count
    FROM analytics.query_telemetry
    WHERE question_hash = ${expectedQuestionHash}
  `);
  invariant(remaining[0]?.count === BigInt(0), 'synthetic telemetry row survived rollback');

  console.log(JSON.stringify({
    status: 'verified-preview-telemetry-execute-and-rollback',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    telemetryRowsObserved: 1,
    unrelatedAnalyticsStateChanges: 0,
    persistedVerificationRows: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
