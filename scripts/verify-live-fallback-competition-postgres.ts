import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * This verifier is deliberately unable to reach a preview, shared, or
 * production database. The CI lane sets the explicit flag after starting its
 * postgres:17 loopback service; local runs need the same opt-in.
 */
export function assertEphemeralPostgres17Target(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.CENTREPASS_EPHEMERAL_PG17_REHEARSAL !== 'true') {
    throw new Error(
      '[live-fallback-rehearsal] CENTREPASS_EPHEMERAL_PG17_REHEARSAL=true is required',
    );
  }

  for (const variable of ['DATABASE_URL', 'DIRECT_URL']) {
    const rawUrl = env[variable];
    if (!rawUrl) {
      throw new Error(`[live-fallback-rehearsal] ${variable} is required`);
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`[live-fallback-rehearsal] ${variable} is not a valid database URL`);
    }
    if (parsed.protocol !== 'postgresql:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new Error(`[live-fallback-rehearsal] ${variable} must target loopback PostgreSQL`);
    }
    if (parsed.port && parsed.port !== '5432') {
      throw new Error(`[live-fallback-rehearsal] ${variable} must target PostgreSQL port 5432`);
    }
  }
}

interface RehearsalFixture {
  seriesId: string;
  competitionIds: string[];
  stageIds: string[];
  matchIds: string[];
  teamIds: string[];
}

interface LoaderSqlEvidence {
  queryEvents: number;
  dataStatements: number;
  joinedStatements: number;
}

function isLoaderDataStatement(query: string): boolean {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return false;
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET|DISCARD)\b/.test(normalized)) {
    return false;
  }
  return !normalized.includes('CURRENT_SETTING(');
}

function summarizeSqlShape(query: string): string {
  const tables = [...query.matchAll(/\bFROM\s+(?:"[^"]+"\.)?"([^"]+)"/gi)]
    .map((match) => match[1])
    .filter((table): table is string => Boolean(table));
  const uniqueTables = [...new Set(tables)].slice(0, 4);
  return `${/\bLATERAL\b/i.test(query) ? 'joined' : 'separate'}:${uniqueTables.join(',') || 'unknown'}`;
}

function assertJoinedLoaderSql(queryEvents: string[]): LoaderSqlEvidence {
  const dataStatements = queryEvents.filter(isLoaderDataStatement);
  const joinedStatements = dataStatements.filter((query) => /\bLATERAL\b/i.test(query));
  if (dataStatements.length !== 2) {
    const shapeCounts = new Map<string, number>();
    for (const statement of dataStatements) {
      const shape = summarizeSqlShape(statement);
      shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
    }
    throw new Error(
      `[live-fallback-rehearsal] expected two joined competition-page statements, observed ${dataStatements.length}; shapes=${JSON.stringify(Object.fromEntries(shapeCounts))}`,
    );
  }
  if (joinedStatements.length !== dataStatements.length) {
    throw new Error(
      '[live-fallback-rehearsal] relationJoins did not produce LATERAL SQL for every competition-page statement',
    );
  }
  return {
    queryEvents: queryEvents.length,
    dataStatements: dataStatements.length,
    joinedStatements: joinedStatements.length,
  };
}

async function verifyPostgres17(
  prisma: PrismaClient,
  sql: typeof import('@prisma/client').Prisma,
): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{
    serverVersion: string;
    databaseName: string;
  }>>(sql.sql`
    SELECT current_setting('server_version_num') AS "serverVersion",
           current_database() AS "databaseName"
  `);
  const row = rows[0];
  if (!row || !row.serverVersion.startsWith('17')) {
    throw new Error('[live-fallback-rehearsal] PostgreSQL 17 is required');
  }
  return row.serverVersion;
}

async function seedFixture(prisma: PrismaClient): Promise<RehearsalFixture> {
  const namespace = `live-fallback-${randomUUID()}`;
  const seriesId = `${namespace}-series`;
  const readyCompetitionId = `${namespace}-ready`;
  const stageId = `${namespace}-stage`;
  const shellIds = Array.from({ length: 34 }, (_, index) => (
    `${namespace}-shell-${String(index).padStart(2, '0')}`
  ));
  const competitionIds = [...shellIds, readyCompetitionId];
  const teamIds = [`${namespace}-team-a`, `${namespace}-team-b`];
  const matchId = `${namespace}-match`;

  await prisma.$transaction(async (transaction) => {
    await transaction.competitionSeries.create({
      data: {
        id: seriesId,
        slug: `${namespace}-series`,
        name: 'Live fallback PostgreSQL rehearsal series',
        kind: 'LEAGUE',
      },
    });

    const shellData: Prisma.CompetitionCreateManyInput[] = shellIds.map((id, index) => ({
      id,
      name: `Published unready shell ${index}`,
      season: 2030,
      seasonStart: index % 2 === 0 ? new Date('2030-01-01T00:00:00.000Z') : null,
      seriesId,
      slug: `shell-${String(index).padStart(2, '0')}`,
      publicationStatus: 'PUBLISHED',
    }));
    await transaction.competition.createMany({ data: shellData });
    await transaction.competition.create({
      data: {
        id: readyCompetitionId,
        name: 'Older ready generic edition',
        season: 2029,
        seasonStart: new Date('2029-01-01T00:00:00.000Z'),
        seriesId,
        slug: `ready-${namespace}`,
        publicationStatus: 'PUBLISHED',
      },
    });
    await transaction.stage.create({
      data: {
        id: stageId,
        competitionId: readyCompetitionId,
        slug: 'regular-season',
        name: 'Regular season',
        type: 'REGULAR_SEASON',
        sequence: 1,
      },
    });

    await transaction.team.createMany({
      data: [
        {
          id: teamIds[0],
          name: 'Rehearsal Team A',
          slug: `${namespace}-team-a`,
          abbreviation: 'RTA',
          competitionId: readyCompetitionId,
        },
        {
          id: teamIds[1],
          name: 'Rehearsal Team B',
          slug: `${namespace}-team-b`,
          abbreviation: 'RTB',
          competitionId: readyCompetitionId,
        },
      ],
    });
    await transaction.editionEntry.createMany({
      data: teamIds.map((teamId, index) => ({
        id: `${namespace}-entry-${index}`,
        competitionId: readyCompetitionId,
        teamId,
        status: 'ACTIVE',
      })),
    });
    await transaction.match.create({
      data: {
        id: matchId,
        competitionId: readyCompetitionId,
        homeTeamId: teamIds[0],
        awayTeamId: teamIds[1],
        venue: 'Rehearsal venue',
        scheduledAt: new Date('2029-02-01T00:00:00.000Z'),
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        stageId,
      },
    });
    const slotCount = await transaction.matchSlot.count({ where: { matchId } });
    if (slotCount !== 2) {
      throw new Error('[live-fallback-rehearsal] CP-01 did not create two match slots');
    }
  });

  return {
    seriesId,
    competitionIds,
    stageIds: [stageId],
    matchIds: [matchId],
    teamIds,
  };
}

async function cleanFixture(
  prisma: PrismaClient,
  fixture: RehearsalFixture,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.matchSlot.deleteMany({ where: { matchId: { in: fixture.matchIds } } });
    await transaction.match.deleteMany({ where: { id: { in: fixture.matchIds } } });
    await transaction.editionEntry.deleteMany({ where: { competitionId: { in: fixture.competitionIds } } });
    await transaction.team.deleteMany({ where: { id: { in: fixture.teamIds } } });
    await transaction.stage.deleteMany({ where: { id: { in: fixture.stageIds } } });
    await transaction.competition.deleteMany({ where: { id: { in: fixture.competitionIds } } });
    await transaction.competitionSeries.deleteMany({ where: { id: fixture.seriesId } });
  });
}

async function main(): Promise<void> {
  assertEphemeralPostgres17Target();
  const { PrismaClient, Prisma: PrismaRuntime } = await import('@prisma/client');
  const prisma = new PrismaClient({
    log: [{ emit: 'event', level: 'query' }],
  });
  const { loadLiveFallbackCompetitionWithClient } = await import('@/lib/competitions');
  const serverVersion = await verifyPostgres17(prisma, PrismaRuntime);
  const fixture = await seedFixture(prisma);
  const queryEvents: string[] = [];
  prisma.$on('query', (event) => queryEvents.push(event.query));
  let result: Record<string, unknown> | null = null;

  try {
    const transactionProbe = async (transaction: Prisma.TransactionClient): Promise<void> => {
      const isolation = await transaction.$queryRaw<Array<{ isolationLevel: string }>>(
        PrismaRuntime.sql`SELECT current_setting('transaction_isolation') AS "isolationLevel"`,
      );
      if (isolation[0]?.isolationLevel !== 'repeatable read') {
        throw new Error('[live-fallback-rehearsal] loader transaction is not RepeatableRead');
      }
    };

    const runLoader = async () => {
      const start = queryEvents.length;
      const selected = await loadLiveFallbackCompetitionWithClient(prisma, transactionProbe);
      const sql = assertJoinedLoaderSql(queryEvents.slice(start));
      return { selected, sql };
    };
    const first = await runLoader();
    const second = await runLoader();
    if (first.selected?.id !== `${fixture.competitionIds[fixture.competitionIds.length - 1]}`) {
      throw new Error('[live-fallback-rehearsal] older ready edition was not selected');
    }
    if (second.selected?.id !== first.selected?.id) {
      throw new Error('[live-fallback-rehearsal] repeated cursor traversal changed selection');
    }
    if (JSON.stringify(second.selected) !== JSON.stringify(first.selected)) {
      throw new Error('[live-fallback-rehearsal] joined loader result changed across identical reads');
    }

    result = {
      event: 'live_fallback_postgres_rehearsal',
      serverVersion,
      isolationLevel: 'repeatable read',
      newerPublishedUnreadyEditions: 34,
      selectedOlderReadyEdition: true,
      repeatedSelectionStable: true,
      repeatedResultParity: true,
      joinedCompetitionPageStatementsPerLoad: [first.sql, second.sql].map((sql) => sql.dataStatements),
      joinedSqlStatementsPerLoad: [first.sql, second.sql].map((sql) => sql.joinedStatements),
      fixtureCleaned: true,
    };
  } finally {
    await cleanFixture(prisma, fixture);
    await prisma.$disconnect();
  }
  if (!result) throw new Error('[live-fallback-rehearsal] verifier produced no result');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
