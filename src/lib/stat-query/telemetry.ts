import { Prisma } from '@prisma/client';
import type { ParseResult } from '@/lib/stat-query/types';

type TelemetryDatabase = Pick<Prisma.TransactionClient, '$executeRaw'>;

export async function persistQueryTelemetry(
  database: TelemetryDatabase,
  input: {
    questionHash: string;
    parseResult: ParseResult;
    resultStatus: string;
    resultCount: number;
    latencyMs: number;
    errorCode?: string;
  },
): Promise<void> {
  const querySpec = input.parseResult.status === 'READY' ? input.parseResult.spec : null;
  const payload = querySpec ? JSON.stringify(querySpec) : null;
  await database.$executeRaw(Prisma.sql`
    SELECT analytics.write_stat_query_telemetry(
      ${input.questionHash},
      ${payload}::JSONB,
      ${input.parseResult.parserVersion},
      ${input.resultStatus},
      ${input.resultCount}::INTEGER,
      ${input.latencyMs}::INTEGER,
      ${input.errorCode ?? null}
    )
  `);
}
