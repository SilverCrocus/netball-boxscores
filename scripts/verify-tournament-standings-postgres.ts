import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { assertEphemeralPostgres17Target } from './verify-live-fallback-competition-postgres';

interface QueryEvent {
  query: string;
}

interface StatementEvidence {
  queryEvents: number;
  dataStatements: number;
  joinedStatements: number;
}

interface PoolFixture {
  seriesId: string;
  competitionId: string;
  stageId: string;
  groupId: string;
  teamIds: string[];
  entryIds: string[];
  matchId: string;
}

interface CanonicalGlasgowFixture {
  competitionId: string;
  addedMatchIds: string[];
  addedSlotIds: string[];
  baselineMatchCount: number;
  baselineSlotCount: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[tournament-standings-rehearsal] ${message}`);
}

function isDataStatement(query: string): boolean {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return false;
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET|DISCARD)\b/.test(normalized)) {
    return false;
  }
  return !normalized.includes('CURRENT_SETTING(');
}

function captureEvidence(events: QueryEvent[]): StatementEvidence {
  const dataStatements = events.filter((event) => isDataStatement(event.query));
  return {
    queryEvents: events.length,
    dataStatements: dataStatements.length,
    joinedStatements: dataStatements.filter((event) => /\bLATERAL\b/i.test(event.query)).length,
  };
}

export function assertMeaningfulStandingsDirectoryReduction(
  legacyDataStatements: number,
  freshDataStatements: number,
): { reduction: number; ratio: number } {
  invariant(Number.isInteger(legacyDataStatements) && Number.isInteger(freshDataStatements),
    'directory statement counts must be integers');
  invariant(legacyDataStatements >= 2, 'legacy directory A/B did not exercise two logical reads');
  invariant(freshDataStatements === 1, 'fresh standings directory must be one data statement');
  invariant(legacyDataStatements > freshDataStatements,
    `fresh directory did not reduce statements: legacy=${legacyDataStatements}, fresh=${freshDataStatements}`);
  return {
    reduction: legacyDataStatements - freshDataStatements,
    ratio: (legacyDataStatements - freshDataStatements) / legacyDataStatements,
  };
}

async function verifyPostgres17(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ serverVersion: string }>>`
    SELECT current_setting('server_version_num') AS "serverVersion"
  `;
  const version = rows[0]?.serverVersion;
  invariant(version?.startsWith('17'), 'PostgreSQL 17 is required');
  return version;
}

async function seedPoolFixture(prisma: PrismaClient): Promise<PoolFixture> {
  const namespace = `phase6-standings-${randomUUID()}`;
  const seriesId = `${namespace}-series`;
  const competitionId = `${namespace}-edition`;
  const stageId = `${namespace}-pool-stage`;
  const groupId = `${namespace}-pool-a`;
  const teamIds = [`${namespace}-team-a`, `${namespace}-team-b`];
  const entryIds = [`${namespace}-entry-a`, `${namespace}-entry-b`];
  const matchId = `${namespace}-match`;

  await prisma.$transaction(async (transaction) => {
    await transaction.competitionSeries.create({
      data: {
        id: seriesId,
        slug: `${namespace}-series`,
        name: 'Phase 6 standings rehearsal series',
        kind: 'TOURNAMENT',
      },
    });
    await transaction.competition.create({
      data: {
        id: competitionId,
        name: 'Phase 6 standings rehearsal edition',
        season: 2040,
        seasonStart: new Date('2040-01-01T00:00:00.000Z'),
        seriesId,
        slug: `${namespace}-edition`,
        publicationStatus: 'PUBLISHED',
      },
    });
    await transaction.stage.create({
      data: {
        id: stageId,
        competitionId,
        slug: 'pool-stage',
        name: 'Pool Stage',
        type: 'POOL',
        sequence: 1,
        isPublished: true,
      },
    });
    await transaction.stageGroup.create({
      data: {
        id: groupId,
        stageId,
        slug: 'pool-a',
        name: 'Pool A',
        sequence: 1,
      },
    });
    await transaction.team.createMany({
      data: teamIds.map((id, index) => ({
        id,
        name: `Phase 6 Team ${index + 1}`,
        slug: `${namespace}-team-${index + 1}`,
        abbreviation: `P6${index + 1}`,
        competitionId,
      })),
    });
    await transaction.editionEntry.createMany({
      data: entryIds.map((id, index) => ({
        id,
        competitionId,
        teamId: teamIds[index]!,
        primaryGroupId: groupId,
        status: 'ACTIVE',
        seed: index + 1,
        displayName: `Phase 6 Team ${index + 1}`,
      })),
    });
    await transaction.match.create({
      data: {
        id: matchId,
        competitionId,
        stageId,
        stageGroupId: groupId,
        venue: 'Phase 6 rehearsal venue',
        scheduledAt: new Date('2040-02-01T00:00:00.000Z'),
        status: 'SCHEDULED',
      },
    });
    await transaction.matchSlot.createMany({
      data: [
        {
          id: `${matchId}-a`,
          matchId,
          side: 'A',
          sourceType: 'TEAM',
          resolvedEntryId: entryIds[0],
        },
        {
          id: `${matchId}-b`,
          matchId,
          side: 'B',
          sourceType: 'TEAM',
          resolvedEntryId: entryIds[1],
        },
      ],
    });
  });

  return { seriesId, competitionId, stageId, groupId, teamIds, entryIds, matchId };
}

async function cleanPoolFixture(prisma: PrismaClient, fixture: PoolFixture): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.stageStanding.deleteMany({ where: { stageId: fixture.stageId } });
    await transaction.matchSlot.deleteMany({ where: { matchId: fixture.matchId } });
    await transaction.match.deleteMany({ where: { id: fixture.matchId } });
    await transaction.editionEntry.deleteMany({ where: { id: { in: fixture.entryIds } } });
    await transaction.stageGroup.deleteMany({ where: { id: fixture.groupId } });
    await transaction.stage.deleteMany({ where: { id: fixture.stageId } });
    await transaction.team.deleteMany({ where: { id: { in: fixture.teamIds } } });
    await transaction.competition.deleteMany({ where: { id: fixture.competitionId } });
    await transaction.competitionSeries.deleteMany({ where: { id: fixture.seriesId } });
  });
}

async function seedCanonicalGlasgowExactAndOverflow(
  prisma: PrismaClient,
): Promise<CanonicalGlasgowFixture> {
  const { GLASGOW_2026_IDENTITY, GLASGOW_2026_EXPECTED_MATCH_COUNT, GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT } =
    await import('@/lib/edition-publication-readiness');
  const canonical = await prisma.competition.findFirst({
    where: {
      series: { slug: GLASGOW_2026_IDENTITY.competitionSlug },
      slug: GLASGOW_2026_IDENTITY.editionSlug,
    },
    select: {
      id: true,
      teams: { orderBy: { id: 'asc' }, select: { id: true } },
      entries: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' }, select: { id: true } },
      stages: { select: { id: true, slug: true, _count: { select: { matches: true } } } },
      _count: { select: { matches: true } },
    },
  });
  invariant(canonical, 'canonical Glasgow seed edition is missing');
  const baselineSlotCount = await prisma.matchSlot.count({
    where: { match: { competitionId: canonical.id } },
  });
  invariant(canonical.teams.length === 12 && canonical.entries.length === 12,
    'canonical Glasgow seed does not have twelve teams and active entries');
  invariant(canonical._count.matches === GLASGOW_2026_EXPECTED_MATCH_COUNT - 1
    && baselineSlotCount === GLASGOW_2026_EXPECTED_MATCH_SLOT_COUNT - 2,
  'canonical Glasgow seed is not the expected 37-match, 74-slot baseline');
  const medalStage = canonical.stages.find((stage) => stage.slug === 'medal-matches');
  invariant(medalStage?.id, 'canonical Glasgow medal stage is missing');
  const namespace = `phase6-glasgow-${randomUUID()}`;
  const addedMatchIds = [`${namespace}-exact`, `${namespace}-overflow`];
  const addedSlotIds = addedMatchIds.flatMap((matchId) => [
    `${matchId}-a`,
    `${matchId}-b`,
  ]);

  const addMatch = async (matchId: string, index: number) => {
    await prisma.$transaction(async (transaction) => {
      await transaction.match.create({
        data: {
          id: matchId,
          competitionId: canonical.id,
          stageId: medalStage.id,
          venue: 'Phase 6 Glasgow rehearsal venue',
          scheduledAt: new Date(`2026-08-${String(20 + index).padStart(2, '0')}T00:00:00.000Z`),
          status: 'SCHEDULED',
        },
      });
      await transaction.matchSlot.createMany({
        data: [
          {
            id: `${matchId}-a`,
            matchId,
            side: 'A',
            sourceType: 'TEAM',
            resolvedEntryId: canonical.entries[index % canonical.entries.length]!.id,
          },
          {
            id: `${matchId}-b`,
            matchId,
            side: 'B',
            sourceType: 'TEAM',
            resolvedEntryId: canonical.entries[(index + 1) % canonical.entries.length]!.id,
          },
        ],
      });
    });
  };

  await addMatch(addedMatchIds[0]!, 0);
  return {
    competitionId: canonical.id,
    addedMatchIds,
    addedSlotIds,
    baselineMatchCount: canonical._count.matches,
    baselineSlotCount,
  };
}

async function cleanCanonicalGlasgowFixture(
  prisma: PrismaClient,
  fixture: CanonicalGlasgowFixture,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.matchSlot.deleteMany({ where: { id: { in: fixture.addedSlotIds } } });
    await transaction.match.deleteMany({ where: { id: { in: fixture.addedMatchIds } } });
    const [restored, slotCount] = await Promise.all([
      transaction.competition.findUnique({
        where: { id: fixture.competitionId },
        select: { _count: { select: { matches: true } } },
      }),
      transaction.matchSlot.count({ where: { match: { competitionId: fixture.competitionId } } }),
    ]);
    invariant(restored?._count.matches === fixture.baselineMatchCount
      && slotCount === fixture.baselineSlotCount,
    'canonical Glasgow seed was not restored after the standings rehearsal');
  });
}

async function main(): Promise<void> {
  assertEphemeralPostgres17Target();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  const {
    loadFreshStandingsCompetitionDirectoryWithClient,
    loadPublicCompetitionNavigationDirectoryWithClient,
  } = await import('@/lib/competitions');
  const {
    getTournamentPoolStandingsUncachedWithClient,
  } = await import('@/lib/tournament/service');

  const queryEvents: QueryEvent[] = [];
  prisma.$on('query', (event) => queryEvents.push(event));
  let poolFixture: PoolFixture | null = null;
  let glasgowFixture: CanonicalGlasgowFixture | null = null;
  let result: Record<string, unknown> | null = null;

  try {
    const serverVersion = await verifyPostgres17(prisma);
    poolFixture = await seedPoolFixture(prisma);

    const directoryLegacyStart = queryEvents.length;
    const legacyDirectory = await loadPublicCompetitionNavigationDirectoryWithClient(prisma);
    const legacyDirectoryEvidence = captureEvidence(queryEvents.slice(directoryLegacyStart));
    invariant(legacyDirectory.some((edition) => edition.id === poolFixture!.competitionId),
      'legacy directory A/B did not include the generic rehearsal edition');

    const directoryFreshStart = queryEvents.length;
    const freshDirectory = await loadFreshStandingsCompetitionDirectoryWithClient(prisma);
    const freshDirectoryEvidence = captureEvidence(queryEvents.slice(directoryFreshStart));
    invariant(freshDirectory.some((edition) => edition.id === poolFixture!.competitionId),
      'fresh standings directory omitted the generic rehearsal edition');
    invariant(freshDirectoryEvidence.joinedStatements >= 1,
      'fresh standings directory did not emit a joined relation projection');
    const directoryReduction = assertMeaningfulStandingsDirectoryReduction(
      legacyDirectoryEvidence.dataStatements,
      freshDirectoryEvidence.dataStatements,
    );

    const preEventStart = queryEvents.length;
    const preEvent = await getTournamentPoolStandingsUncachedWithClient(prisma, poolFixture.competitionId);
    const preEventEvidence = captureEvidence(queryEvents.slice(preEventStart));
    invariant(preEvent?.hasAnyStandings === false
      && preEvent.pools.every((pool) => pool.rows.every((row) => row.standing === null)),
    'pre-event pool standings manufactured statistic rows');
    invariant(preEventEvidence.dataStatements === 1 && preEventEvidence.joinedStatements === 1,
      'pre-event pool standings did not use one joined data statement');
    const preEventBytes = JSON.stringify(preEvent);
    const preEventReplay = await getTournamentPoolStandingsUncachedWithClient(
      prisma,
      poolFixture.competitionId,
    );
    invariant(JSON.stringify(preEventReplay) === preEventBytes,
      'pre-event projected bytes changed across equivalent reads');

    await prisma.stageStanding.createMany({
      data: poolFixture.entryIds.map((editionEntryId, index) => ({
        id: `${poolFixture!.stageId}-standing-${index + 1}`,
        stageId: poolFixture!.stageId,
        stageGroupId: poolFixture!.groupId,
        editionEntryId,
        rank: index + 1,
        played: 1,
        wins: index === 0 ? 1 : 0,
        losses: index === 0 ? 0 : 1,
        draws: 0,
        goalsFor: index === 0 ? 60 : 50,
        goalsAgainst: index === 0 ? 50 : 60,
        goalPercentage: index === 0 ? 120 : 83.333,
        points: index === 0 ? 2 : 0,
      })),
    });
    const populatedStart = queryEvents.length;
    const populated = await getTournamentPoolStandingsUncachedWithClient(prisma, poolFixture.competitionId);
    const populatedEvidence = captureEvidence(queryEvents.slice(populatedStart));
    invariant(populated?.hasAnyStandings === true
      && populated.pools[0]?.rows[0]?.standing?.rank === 1,
    'populated pool standings did not project StageStanding rows');
    invariant(populatedEvidence.dataStatements === 1 && populatedEvidence.joinedStatements === 1,
      'populated pool standings did not use one joined data statement');
    const populatedBytes = JSON.stringify(populated);
    const populatedReplay = await getTournamentPoolStandingsUncachedWithClient(
      prisma,
      poolFixture.competitionId,
    );
    invariant(JSON.stringify(populatedReplay) === populatedBytes
      && preEventBytes !== populatedBytes,
    'pool standings projections were not byte-stable and distinct across the result transition');

    const cacheStore = new Map<string, string>();
    let cacheLoaderCalls = 0;
    const cachedReader = async (competitionId: string) => {
      const key = JSON.stringify([competitionId, 'tournament-standings-v1']);
      const stored = cacheStore.get(key);
      if (stored !== undefined) return JSON.parse(stored) as typeof populated;
      cacheLoaderCalls += 1;
      const value = await getTournamentPoolStandingsUncachedWithClient(prisma, competitionId);
      cacheStore.set(key, JSON.stringify(value));
      return value;
    };
    const cachedMissStart = queryEvents.length;
    const cachedCold = await cachedReader(poolFixture.competitionId);
    const cachedMissEvidence = captureEvidence(queryEvents.slice(cachedMissStart));
    const cachedWarmStart = queryEvents.length;
    const cachedWarm = await cachedReader(poolFixture.competitionId);
    const cachedWarmEvidence = captureEvidence(queryEvents.slice(cachedWarmStart));
    invariant(JSON.stringify(cachedCold) === JSON.stringify(cachedWarm)
      && cacheLoaderCalls === 1
      && cachedMissEvidence.dataStatements === 1
      && cachedWarmEvidence.dataStatements === 0,
    'canonical cache miss/warm pool query contract failed');

    glasgowFixture = await seedCanonicalGlasgowExactAndOverflow(prisma);
    const exactDirectory = await loadFreshStandingsCompetitionDirectoryWithClient(prisma);
    invariant(exactDirectory.some((edition) => edition.series?.slug === 'commonwealth-games-netball'
      && edition.slug === 'glasgow-2026'),
    'exact Glasgow readiness projection was not visible');
    const overflowStart = queryEvents.length;
    await prisma.$transaction(async (transaction) => {
      const medalStage = await transaction.stage.findFirst({
        where: { competitionId: glasgowFixture!.competitionId, slug: 'medal-matches' },
        select: { id: true },
      });
      invariant(medalStage, 'canonical Glasgow medal stage disappeared before overflow fixture');
      await transaction.match.create({
        data: {
          id: glasgowFixture!.addedMatchIds[1]!,
          competitionId: glasgowFixture!.competitionId,
          venue: 'Phase 6 Glasgow overflow venue',
          scheduledAt: new Date('2026-08-22T00:00:00.000Z'),
          status: 'SCHEDULED',
          stageId: medalStage.id,
        },
      });
      await transaction.matchSlot.createMany({
        data: glasgowFixture!.addedSlotIds.slice(2).map((id, index) => ({
          id,
          matchId: glasgowFixture!.addedMatchIds[1]!,
          side: index === 0 ? 'A' as const : 'B' as const,
          sourceType: 'UNRESOLVED' as const,
          sourceLabel: 'Phase 6 overflow',
        })),
      });
    });
    const overflowDirectory = await loadFreshStandingsCompetitionDirectoryWithClient(prisma);
    const overflowEvidence = captureEvidence(queryEvents.slice(overflowStart));
    invariant(!overflowDirectory.some((edition) => edition.series?.slug === 'commonwealth-games-netball'
      && edition.slug === 'glasgow-2026'),
    'Glasgow +1 match overflow was incorrectly public-ready');
    invariant(overflowEvidence.dataStatements >= 1, 'overflow readiness was not executed against PostgreSQL');

    result = {
      event: 'tournament_standings_postgres_rehearsal',
      serverVersion,
      legacyDirectoryLogicalReads: 2,
      freshDirectoryLogicalReads: 1,
      legacyDirectoryDataStatements: legacyDirectoryEvidence.dataStatements,
      freshDirectoryDataStatements: freshDirectoryEvidence.dataStatements,
      freshDirectoryJoinedStatements: freshDirectoryEvidence.joinedStatements,
      directoryStatementReduction: directoryReduction.reduction,
      directoryStatementReductionRatio: directoryReduction.ratio,
      preEventProjectionParity: JSON.stringify(preEvent) === preEventBytes,
      populatedProjectionParity: JSON.stringify(populated) === populatedBytes,
      preEventJoinedDataStatements: preEventEvidence.joinedStatements,
      populatedJoinedDataStatements: populatedEvidence.joinedStatements,
      cachedMissPoolDataStatements: cachedMissEvidence.dataStatements,
      cachedWarmPoolDataStatements: cachedWarmEvidence.dataStatements,
      cachedLoaderCalls: cacheLoaderCalls,
      populatedCacheProjectionParity: JSON.stringify(cachedCold) === populatedBytes,
      exactGlasgowReadinessVisible: true,
      glasgowOverflowRejected: true,
      fixtureNamespaceCleaned: true,
      rawSqlLogged: false,
    };
  } finally {
    if (glasgowFixture) await cleanCanonicalGlasgowFixture(prisma, glasgowFixture);
    if (poolFixture) await cleanPoolFixture(prisma, poolFixture);
    await prisma.$disconnect();
  }

  invariant(result, 'verifier produced no result');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
