import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import {
  GLASGOW_2026_IDENTITY,
  GLASGOW_2026_EXPECTED_MATCH_COUNT,
  GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT,
  GLASGOW_2026_EXPECTED_STAGES,
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
  glasgowEditionSnapshot: GlasgowEditionSnapshot;
}

interface GlasgowEditionSnapshot {
  id: string;
  name: string;
  season: number;
  seasonStart: Date | null;
  seriesId: string | null;
  slug: string | null;
  label: string | null;
  sourceTimezone: string;
  rulesetId: string | null;
  publicationStatus: string;
  publishedAt: Date | null;
  teamCount: number;
  activeEntryCount: number;
  stageCount: number;
  matchCount: number;
  matchSlotCount: number;
  importCount: number;
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
  const readyCompetitionId = `${namespace}-ready`;
  const readyStageId = `${namespace}-stage`;
  const shellIds = Array.from({ length: 34 }, (_, index) => (
    `${namespace}-shell-${String(index).padStart(2, '0')}`
  ));
  const competitionIds = [...shellIds, readyCompetitionId];
  const readyTeamIds = [`${namespace}-team-a`, `${namespace}-team-b`];
  const readyMatchId = `${namespace}-match`;
  const glasgowMatchIds = Array.from({ length: 2 }, (_, index) => (
    `${namespace}-glasgow-match-${String(index + 1).padStart(2, '0')}`
  ));
  const matchIds = [readyMatchId, ...glasgowMatchIds];
  const seriesIds = [seriesId];
  let glasgowEditionSnapshot: GlasgowEditionSnapshot | null = null;

  await prisma.$transaction(async (transaction) => {
    const canonicalGlasgowEdition = await transaction.competition.findFirst({
      where: {
        series: { slug: GLASGOW_2026_IDENTITY.competitionSlug },
        slug: GLASGOW_2026_IDENTITY.editionSlug,
      },
      select: {
        id: true,
        name: true,
        season: true,
        seasonStart: true,
        seriesId: true,
        slug: true,
        label: true,
        sourceTimezone: true,
        rulesetId: true,
        publicationStatus: true,
        publishedAt: true,
        series: { select: { id: true, slug: true } },
        teams: { orderBy: { id: 'asc' }, select: { id: true } },
        entries: {
          where: { status: 'ACTIVE' },
          orderBy: { id: 'asc' },
          select: { teamId: true },
        },
        stages: {
          orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            slug: true,
            type: true,
            sequence: true,
            isPublished: true,
            _count: { select: { groups: true, matches: true } },
          },
        },
        matches: { orderBy: { id: 'asc' }, select: { id: true } },
        _count: { select: { stages: true } },
      },
    });
    if (!canonicalGlasgowEdition) {
      throw new Error('[live-fallback-rehearsal] canonical Glasgow seed edition is missing');
    }
    const canonicalMatchSlotCount = await transaction.matchSlot.count({
      where: { match: { competitionId: canonicalGlasgowEdition.id } },
    });
    const canonicalImportCount = await transaction.importRun.count({
      where: {
        competitionId: canonicalGlasgowEdition.id,
        sourceSystem: { key: 'glasgow-2026-public-data' },
        status: 'SUCCEEDED',
        dryRun: false,
        issueCount: 0,
      },
    });
    const stageBySlug = new Map(canonicalGlasgowEdition.stages.map((stage) => [stage.slug, stage]));
    const expectedStageShape = GLASGOW_2026_EXPECTED_STAGES.every((expected) => {
      const stage = stageBySlug.get(expected.slug);
      const expectedBaselineMatchCount = expected.slug === 'medal-matches'
        ? expected.matchCount - 1
        : expected.matchCount;
      return stage?.type === expected.type
        && stage.sequence === expected.sequence
        && stage.isPublished
        && stage._count.groups === expected.groupCount
        && stage._count.matches === expectedBaselineMatchCount;
    });
    const activeTeamIds = canonicalGlasgowEdition.entries.map((entry) => entry.teamId);
    const uniqueActiveTeamIds = new Set(activeTeamIds);
    if (canonicalGlasgowEdition.series?.slug !== GLASGOW_2026_IDENTITY.competitionSlug
      || canonicalGlasgowEdition.series.id !== canonicalGlasgowEdition.seriesId
      || canonicalGlasgowEdition.publicationStatus !== 'PUBLISHED'
      || canonicalGlasgowEdition.season !== 2026
      || canonicalGlasgowEdition.teams.length !== GLASGOW_2026_EXPECTED_TEAM_COUNT
      || canonicalGlasgowEdition.entries.length !== GLASGOW_2026_EXPECTED_TEAM_COUNT
      || uniqueActiveTeamIds.size !== GLASGOW_2026_EXPECTED_TEAM_COUNT
      || canonicalGlasgowEdition.stages.length !== GLASGOW_2026_EXPECTED_STAGES.length
      || canonicalGlasgowEdition._count.stages !== GLASGOW_2026_EXPECTED_STAGES.length
      || canonicalGlasgowEdition.matches.length !== GLASGOW_2026_EXPECTED_MATCH_COUNT - 1
      || canonicalMatchSlotCount !== GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT - 2
      || canonicalImportCount !== 1
      || !expectedStageShape) {
      throw new Error('[live-fallback-rehearsal] canonical Glasgow seed is not the isolated 37-match baseline');
    }
    const stageIdsBySlug = new Map(canonicalGlasgowEdition.stages.map((stage) => [stage.slug, stage.id]));
    for (const expected of GLASGOW_2026_EXPECTED_STAGES) {
      if (!stageIdsBySlug.has(expected.slug)) {
        throw new Error(`[live-fallback-rehearsal] canonical Glasgow seed is missing ${expected.slug}`);
      }
    }
    glasgowEditionSnapshot = {
      id: canonicalGlasgowEdition.id,
      name: canonicalGlasgowEdition.name,
      season: canonicalGlasgowEdition.season,
      seasonStart: canonicalGlasgowEdition.seasonStart,
      seriesId: canonicalGlasgowEdition.seriesId,
      slug: canonicalGlasgowEdition.slug,
      label: canonicalGlasgowEdition.label,
      sourceTimezone: canonicalGlasgowEdition.sourceTimezone,
      rulesetId: canonicalGlasgowEdition.rulesetId,
      publicationStatus: canonicalGlasgowEdition.publicationStatus,
      publishedAt: canonicalGlasgowEdition.publishedAt,
      teamCount: canonicalGlasgowEdition.teams.length,
      activeEntryCount: canonicalGlasgowEdition.entries.length,
      stageCount: canonicalGlasgowEdition.stages.length,
      matchCount: canonicalGlasgowEdition.matches.length,
      matchSlotCount: canonicalMatchSlotCount,
      importCount: canonicalImportCount,
    };

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
        id: readyStageId,
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
    await transaction.match.createMany({
      data: glasgowMatchIds.map((id, index) => {
        const stageId = index === 0
          ? stageIdsBySlug.get('medal-matches')!
          : stageIdsBySlug.get('classification')!;
        const teamIds = activeTeamIds;
        return {
          id,
          competitionId: canonicalGlasgowEdition.id,
          homeTeamId: teamIds[index % teamIds.length]!,
          awayTeamId: teamIds[(index + 1) % teamIds.length]!,
          venue: `Glasgow rehearsal venue ${index + 1}`,
          scheduledAt: new Date(`2026-08-${String(index + 15).padStart(2, '0')}T00:00:00.000Z`),
          status: 'COMPLETED' as const,
          resultQuality: 'UNKNOWN' as const,
          stageId,
          stageGroupId: null,
        };
      }),
    });
    const addedSlotCount = await transaction.matchSlot.count({ where: { matchId: { in: glasgowMatchIds } } });
    const readySlotCount = await transaction.matchSlot.count({ where: { matchId: readyMatchId } });
    if (readySlotCount !== 2
      || addedSlotCount !== 4) {
      throw new Error('[live-fallback-rehearsal] CP-01 did not create two match slots');
    }
  });

  const capturedGlasgowEdition = glasgowEditionSnapshot as GlasgowEditionSnapshot | null;
  if (!capturedGlasgowEdition) {
    throw new Error('[live-fallback-rehearsal] canonical Glasgow snapshot was not captured');
  }

  return {
    seriesIds,
    competitionIds,
    stageIds: [readyStageId],
    stageGroupIds: [],
    matchIds,
    teamIds: readyTeamIds,
    sourceSystemIds: [],
    importRunIds: [],
    glasgowOverflowCompetitionId: capturedGlasgowEdition.id,
    glasgowEditionSnapshot: capturedGlasgowEdition,
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

    const restored = await transaction.competition.findUnique({
      where: { id: fixture.glasgowEditionSnapshot.id },
      select: {
        id: true,
        name: true,
        season: true,
        seasonStart: true,
        seriesId: true,
        slug: true,
        label: true,
        sourceTimezone: true,
        rulesetId: true,
        publicationStatus: true,
        publishedAt: true,
        _count: {
          select: {
            teams: true,
            entries: { where: { status: 'ACTIVE' } },
            stages: true,
            matches: true,
          },
        },
      },
    });
    const snapshot = fixture.glasgowEditionSnapshot;
    const scalarStateRestored = restored !== null
      && restored.id === snapshot.id
      && restored.name === snapshot.name
      && restored.season === snapshot.season
      && restored.seasonStart?.getTime() === snapshot.seasonStart?.getTime()
      && restored.seriesId === snapshot.seriesId
      && restored.slug === snapshot.slug
      && restored.label === snapshot.label
      && restored.sourceTimezone === snapshot.sourceTimezone
      && restored.rulesetId === snapshot.rulesetId
      && restored.publicationStatus === snapshot.publicationStatus
      && restored.publishedAt?.getTime() === snapshot.publishedAt?.getTime()
      && restored._count.teams === snapshot.teamCount
      && restored._count.entries === snapshot.activeEntryCount
      && restored._count.stages === snapshot.stageCount
      && restored._count.matches === snapshot.matchCount;
    const restoredMatchSlotCount = await transaction.matchSlot.count({
      where: { match: { competitionId: snapshot.id } },
    });
    const restoredImportCount = await transaction.importRun.count({
      where: {
        competitionId: snapshot.id,
        sourceSystem: { key: 'glasgow-2026-public-data' },
        status: 'SUCCEEDED',
        dryRun: false,
        issueCount: 0,
      },
    });
    if (!scalarStateRestored
      || restoredMatchSlotCount !== snapshot.matchSlotCount
      || restoredImportCount !== snapshot.importCount) {
      throw new Error('[live-fallback-rehearsal] canonical Glasgow seed was not restored after cleanup');
    }
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
      canonicalGlasgowSeedReused: true,
      canonicalGlasgowSeedRestored: true,
      canonicalGlasgowBaselineMatchCount: fixture.glasgowEditionSnapshot.matchCount,
      canonicalGlasgowBaselineMatchSlotCount: fixture.glasgowEditionSnapshot.matchSlotCount,
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
