import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import {
  GLASGOW_2026_EXPECTED_MATCH_COUNT,
  GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT,
  GLASGOW_2026_EXPECTED_STAGE_COUNT,
  GLASGOW_2026_EXPECTED_TEAM_COUNT,
} from '@/lib/edition-publication-readiness';

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
  seriesIds: string[];
  competitionIds: string[];
  stageIds: string[];
  stageGroupIds: string[];
  matchIds: string[];
  teamIds: string[];
  sourceSystemIds: string[];
  importRunIds: string[];
  glasgowOverflowCompetitionId: string;
}

interface LoaderSqlEvidence {
  queryEvents: number;
  dataStatements: number;
  joinedStatements: number;
}

export const MIN_MEANINGFUL_RELATION_REDUCTION_RATIO = 0.25;
export const MIN_MEANINGFUL_RELATION_REDUCTION_DELTA = 2;

export function assertMeaningfulRelationReduction(
  queryDataStatements: number,
  joinDataStatements: number,
): { reduction: number; ratio: number; minimumReduction: number } {
  if (!Number.isInteger(queryDataStatements) || !Number.isInteger(joinDataStatements)
    || queryDataStatements <= 0 || joinDataStatements <= 0) {
    throw new Error('[live-fallback-rehearsal] relation statement counts are not non-vacuous');
  }
  const reduction = queryDataStatements - joinDataStatements;
  const ratio = reduction / queryDataStatements;
  const minimumReduction = Math.max(
    MIN_MEANINGFUL_RELATION_REDUCTION_DELTA,
    Math.ceil(queryDataStatements * MIN_MEANINGFUL_RELATION_REDUCTION_RATIO),
  );
  if (joinDataStatements >= queryDataStatements
    || reduction < minimumReduction
    || ratio < MIN_MEANINGFUL_RELATION_REDUCTION_RATIO) {
    throw new Error(
      `[live-fallback-rehearsal] relation join reduction is not meaningful: query=${queryDataStatements}, join=${joinDataStatements}, reduction=${reduction}, ratio=${ratio.toFixed(3)}, requiredReduction=${minimumReduction}`,
    );
  }
  return { reduction, ratio, minimumReduction };
}

function isLoaderDataStatement(query: string): boolean {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return false;
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET|DISCARD)\b/.test(normalized)) {
    return false;
  }
  return !normalized.includes('CURRENT_SETTING(');
}

function captureLoaderSql(queryEvents: string[]): LoaderSqlEvidence {
  const dataStatements = queryEvents.filter(isLoaderDataStatement);
  const joinedStatements = dataStatements.filter((query) => /\bLATERAL\b/i.test(query));
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
  const glasgowSeriesId = `${namespace}-glasgow-series`;
  const readyCompetitionId = `${namespace}-ready`;
  const readyStageId = `${namespace}-stage`;
  const shellIds = Array.from({ length: 34 }, (_, index) => (
    `${namespace}-shell-${String(index).padStart(2, '0')}`
  ));
  const glasgowOverflowCompetitionId = shellIds[0]!;
  const glasgowStageIds = Array.from({ length: GLASGOW_2026_EXPECTED_STAGE_COUNT }, (_, index) => (
    `${namespace}-glasgow-stage-${index + 1}`
  ));
  const glasgowStageGroupIds = Array.from({ length: 2 }, (_, index) => (
    `${namespace}-glasgow-group-${index + 1}`
  ));
  const competitionIds = [...shellIds, readyCompetitionId];
  const readyTeamIds = [`${namespace}-team-a`, `${namespace}-team-b`];
  const glasgowTeamIds = Array.from({ length: GLASGOW_2026_EXPECTED_TEAM_COUNT }, (_, index) => (
    `${namespace}-glasgow-team-${String(index + 1).padStart(2, '0')}`
  ));
  const teamIds = [...readyTeamIds, ...glasgowTeamIds];
  const readyMatchId = `${namespace}-match`;
  const glasgowMatchIds = Array.from({ length: GLASGOW_2026_EXPECTED_MATCH_COUNT + 1 }, (_, index) => (
    `${namespace}-glasgow-match-${String(index + 1).padStart(2, '0')}`
  ));
  const matchIds = [readyMatchId, ...glasgowMatchIds];
  const sourceSystemId = `${namespace}-glasgow-source`;
  const importRunId = `${namespace}-glasgow-import`;

  await prisma.$transaction(async (transaction) => {
    await transaction.competitionSeries.createMany({
      data: [
        {
          id: seriesId,
          slug: `${namespace}-series`,
          name: 'Live fallback PostgreSQL rehearsal series',
          kind: 'LEAGUE',
        },
        {
          id: glasgowSeriesId,
          slug: 'commonwealth-games-netball',
          name: 'Commonwealth Games Netball rehearsal series',
          kind: 'TOURNAMENT',
        },
      ],
    });

    const shellData: Prisma.CompetitionCreateManyInput[] = shellIds.map((id, index) => ({
      id,
      name: id === glasgowOverflowCompetitionId
        ? 'Published Glasgow overflow shell'
        : `Published unready shell ${index}`,
      season: 2030,
      seasonStart: index % 2 === 0 ? new Date('2030-01-01T00:00:00.000Z') : null,
      seriesId: id === glasgowOverflowCompetitionId ? glasgowSeriesId : seriesId,
      slug: id === glasgowOverflowCompetitionId
        ? 'glasgow-2026'
        : `shell-${String(index).padStart(2, '0')}`,
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
        id: readyStageId,
        competitionId: readyCompetitionId,
        slug: 'regular-season',
        name: 'Regular season',
        type: 'REGULAR_SEASON',
        sequence: 1,
      },
    });

    await transaction.stage.createMany({
      data: [
        { id: glasgowStageIds[0]!, competitionId: glasgowOverflowCompetitionId, slug: 'pool-stage', name: 'Pool stage', type: 'POOL', sequence: 1, isPublished: true },
        { id: glasgowStageIds[1]!, competitionId: glasgowOverflowCompetitionId, slug: 'classification', name: 'Classification', type: 'CLASSIFICATION', sequence: 2, isPublished: true },
        { id: glasgowStageIds[2]!, competitionId: glasgowOverflowCompetitionId, slug: 'semi-finals', name: 'Semi-finals', type: 'SEMI_FINALS', sequence: 3, isPublished: true },
        { id: glasgowStageIds[3]!, competitionId: glasgowOverflowCompetitionId, slug: 'medal-matches', name: 'Medal matches', type: 'MEDAL_MATCHES', sequence: 4, isPublished: true },
      ],
    });
    await transaction.stageGroup.createMany({
      data: glasgowStageGroupIds.map((id, index) => ({
        id,
        stageId: glasgowStageIds[0]!,
        slug: `pool-${String(index + 1)}`,
        name: `Pool ${String.fromCharCode(65 + index)}`,
        sequence: index + 1,
      })),
    });

    await transaction.team.createMany({
      data: [
        {
          id: readyTeamIds[0]!,
          name: 'Rehearsal Team A',
          slug: `${namespace}-team-a`,
          abbreviation: 'RTA',
          competitionId: readyCompetitionId,
        },
        {
          id: readyTeamIds[1]!,
          name: 'Rehearsal Team B',
          slug: `${namespace}-team-b`,
          abbreviation: 'RTB',
          competitionId: readyCompetitionId,
        },
        ...glasgowTeamIds.map((id, index) => ({
          id,
          name: `Glasgow rehearsal team ${index + 1}`,
          slug: `${namespace}-glasgow-team-${String(index + 1).padStart(2, '0')}`,
          abbreviation: `G${String(index + 1).padStart(2, '0')}`,
          competitionId: glasgowOverflowCompetitionId,
        })),
      ],
    });
    await transaction.editionEntry.createMany({
      data: readyTeamIds.map((teamId, index) => ({
        id: `${namespace}-entry-${index}`,
        competitionId: readyCompetitionId,
        teamId,
        status: 'ACTIVE',
      })),
    });
    await transaction.match.create({
      data: {
        id: readyMatchId,
        competitionId: readyCompetitionId,
        homeTeamId: readyTeamIds[0],
        awayTeamId: readyTeamIds[1],
        venue: 'Rehearsal venue',
        scheduledAt: new Date('2029-02-01T00:00:00.000Z'),
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        stageId: readyStageId,
      },
    });
    await transaction.editionEntry.createMany({
      data: glasgowTeamIds.map((teamId, index) => ({
        id: `${namespace}-glasgow-entry-${String(index + 1).padStart(2, '0')}`,
        competitionId: glasgowOverflowCompetitionId,
        teamId,
        status: 'ACTIVE',
      })),
    });
    await transaction.match.createMany({
      data: glasgowMatchIds.map((id, index) => {
        const stageId = index < 31
          ? glasgowStageIds[0]!
          : index < 35
            ? glasgowStageIds[1]!
            : index < 37
              ? glasgowStageIds[2]!
              : glasgowStageIds[3]!;
        return {
          id,
          competitionId: glasgowOverflowCompetitionId,
          homeTeamId: glasgowTeamIds[index % glasgowTeamIds.length]!,
          awayTeamId: glasgowTeamIds[(index + 1) % glasgowTeamIds.length]!,
          venue: `Glasgow rehearsal venue ${index + 1}`,
          scheduledAt: new Date(`2030-02-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
          status: 'COMPLETED' as const,
          resultQuality: 'OFFICIAL_FINAL' as const,
          stageId,
          stageGroupId: index < 31 ? glasgowStageGroupIds[index % glasgowStageGroupIds.length]! : null,
        };
      }),
    });
    await transaction.sourceSystem.create({
      data: {
        id: sourceSystemId,
        key: 'glasgow-2026-public-data',
        name: 'Glasgow rehearsal public data',
        kind: 'PUBLIC_PAGE',
      },
    });
    await transaction.importRun.create({
      data: {
        id: importRunId,
        sourceSystemId,
        competitionId: glasgowOverflowCompetitionId,
        trigger: 'MANUAL',
        status: 'SUCCEEDED',
        dryRun: false,
        completedAt: new Date('2030-01-01T00:00:00.000Z'),
        checksum: `${namespace}-checksum`,
        issueCount: 0,
      },
    });
    const readySlotCount = await transaction.matchSlot.count({ where: { matchId: readyMatchId } });
    const glasgowSlotCount = await transaction.matchSlot.count({ where: { matchId: { in: glasgowMatchIds } } });
    if (readySlotCount !== 2
      || glasgowSlotCount !== GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT + 2) {
      throw new Error('[live-fallback-rehearsal] CP-01 did not create two match slots');
    }
  });

  return {
    seriesIds: [seriesId, glasgowSeriesId],
    competitionIds,
    stageIds: [readyStageId, ...glasgowStageIds],
    stageGroupIds: glasgowStageGroupIds,
    matchIds,
    teamIds,
    sourceSystemIds: [sourceSystemId],
    importRunIds: [importRunId],
    glasgowOverflowCompetitionId,
  };
}

async function cleanFixture(
  prisma: PrismaClient,
  fixture: RehearsalFixture,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.matchSlot.deleteMany({ where: { matchId: { in: fixture.matchIds } } });
    await transaction.match.deleteMany({ where: { id: { in: fixture.matchIds } } });
    await transaction.importRun.deleteMany({ where: { id: { in: fixture.importRunIds } } });
    await transaction.editionEntry.deleteMany({ where: { competitionId: { in: fixture.competitionIds } } });
    await transaction.team.deleteMany({ where: { id: { in: fixture.teamIds } } });
    await transaction.stageGroup.deleteMany({ where: { id: { in: fixture.stageGroupIds } } });
    await transaction.stage.deleteMany({ where: { id: { in: fixture.stageIds } } });
    await transaction.competition.deleteMany({ where: { id: { in: fixture.competitionIds } } });
    await transaction.sourceSystem.deleteMany({ where: { id: { in: fixture.sourceSystemIds } } });
    await transaction.competitionSeries.deleteMany({ where: { id: { in: fixture.seriesIds } } });
  });
}

async function main(): Promise<void> {
  assertEphemeralPostgres17Target();
  const { PrismaClient, Prisma: PrismaRuntime } = await import('@prisma/client');
  const prisma = new PrismaClient({
    log: [{ emit: 'event', level: 'query' }],
  });
  const {
    isEditionPubliclyReady,
    liveFallbackCompetitionSelect,
    loadLiveFallbackCompetitionWithClient,
    LIVE_FALLBACK_GLASGOW_MATCH_EVIDENCE_LIMIT,
    LIVE_FALLBACK_GLASGOW_STAGE_EVIDENCE_LIMIT,
  } = await import('@/lib/competitions');
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

    const glasgowOverflow = await prisma.competition.findUnique({
      where: { id: fixture.glasgowOverflowCompetitionId },
      select: liveFallbackCompetitionSelect,
      relationLoadStrategy: 'join',
    });
    if (!glasgowOverflow || glasgowOverflow.stages.length === 0 || glasgowOverflow.matches.length === 0) {
      throw new Error('[live-fallback-rehearsal] strict Glasgow overflow projection was empty');
    }
    if (glasgowOverflow._count.matches !== GLASGOW_2026_EXPECTED_MATCH_COUNT + 1
      || glasgowOverflow.matches.length !== LIVE_FALLBACK_GLASGOW_MATCH_EVIDENCE_LIMIT
      || glasgowOverflow.stages.length > LIVE_FALLBACK_GLASGOW_STAGE_EVIDENCE_LIMIT) {
      throw new Error('[live-fallback-rehearsal] strict Glasgow overflow evidence was not bounded as expected');
    }
    if (isEditionPubliclyReady(glasgowOverflow)) {
      throw new Error('[live-fallback-rehearsal] Glasgow match overflow was incorrectly public-ready');
    }

    const runLoader = async (relationLoadStrategy: 'join' | 'query') => {
      const start = queryEvents.length;
      const selected = await loadLiveFallbackCompetitionWithClient(
        prisma,
        transactionProbe,
        relationLoadStrategy,
      );
      const sql = captureLoaderSql(queryEvents.slice(start));
      return { selected, sql };
    };
    const queryMode = await runLoader('query');
    const joinMode = await runLoader('join');
    if (queryMode.selected?.id !== `${fixture.competitionIds[fixture.competitionIds.length - 1]}`) {
      throw new Error('[live-fallback-rehearsal] older ready edition was not selected');
    }
    if (joinMode.selected?.id !== queryMode.selected?.id) {
      throw new Error('[live-fallback-rehearsal] join/query selection parity failed');
    }
    if (JSON.stringify(joinMode.selected) !== JSON.stringify(queryMode.selected)) {
      throw new Error('[live-fallback-rehearsal] join/query result parity failed');
    }
    if (queryMode.sql.joinedStatements !== 0) {
      throw new Error('[live-fallback-rehearsal] query strategy unexpectedly emitted LATERAL SQL');
    }
    if (joinMode.sql.joinedStatements === 0) {
      throw new Error('[live-fallback-rehearsal] join strategy emitted no LATERAL SQL');
    }
    const reduction = assertMeaningfulRelationReduction(
      queryMode.sql.dataStatements,
      joinMode.sql.dataStatements,
    );

    result = {
      event: 'live_fallback_postgres_rehearsal',
      serverVersion,
      isolationLevel: 'repeatable read',
      newerPublishedUnreadyEditions: 34,
      selectedOlderReadyEdition: true,
      joinQuerySelectionParity: true,
      joinQueryResultParity: true,
      glasgowOverflowProjectionNonEmpty: true,
      glasgowOverflowRejected: true,
      glasgowOverflowMatchCount: glasgowOverflow._count.matches,
      glasgowOverflowMatchEvidenceRows: glasgowOverflow.matches.length,
      glasgowOverflowStageEvidenceRows: glasgowOverflow.stages.length,
      queryModeQueryEvents: queryMode.sql.queryEvents,
      joinModeQueryEvents: joinMode.sql.queryEvents,
      queryModeDataStatements: queryMode.sql.dataStatements,
      joinModeDataStatements: joinMode.sql.dataStatements,
      joinModeJoinedStatements: joinMode.sql.joinedStatements,
      dataStatementReduction: reduction.reduction,
      dataStatementReductionRatio: reduction.ratio,
      minimumMeaningfulReduction: reduction.minimumReduction,
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
