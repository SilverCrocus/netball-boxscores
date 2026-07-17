import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats } from '@/lib/champion-data';
import type { Prisma } from '@prisma/client';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

export interface IngestedData {
  fixture: CDFixtureMatch[];
  fixtureObservationAt: Date;
  matchDetails: Map<number, CDMatchStatsResponse>;
  pollLogIds: string[];
  matchPollLogIds: Map<number, string>;
  detailFetchErrors: number;
}

export async function ingestFromChampionData(
  competitionId: number,
): Promise<IngestedData> {
  const pollLogIds: string[] = [];
  const matchPollLogIds = new Map<number, string>();
  const matchDetails = new Map<number, CDMatchStatsResponse>();
  let detailFetchErrors = 0;

  // Cleanup old PollLog entries (7-day retention)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.pollLog.deleteMany({
    where: { polledAt: { lt: sevenDaysAgo } },
  });

  // Fetch fixture
  let fixture: CDFixtureMatch[];
  const fixtureObservationAt = new Date();
  try {
    fixture = await fetchFixture(competitionId);
    const log = await prisma.pollLog.create({
      data: {
        competitionId,
        polledAt: fixtureObservationAt,
        endpoint: 'fixture',
        rawResponse: fixture as unknown as Prisma.InputJsonValue,
        status: 'success',
      },
    });
    pollLogIds.push(log.id);
  } catch (error) {
    await prisma.pollLog.create({
      data: {
        competitionId,
        polledAt: fixtureObservationAt,
        endpoint: 'fixture',
        rawResponse: {},
        status: 'fetch_error',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  // Determine which matches need detail fetching
  const existingMatches = new Map<number, { status: string; playerStats: number }>();
  const existingDbMatches = await prisma.match.findMany({
    where: { championDataMatchId: { not: null } },
    select: {
      championDataMatchId: true,
      status: true,
      _count: { select: { playerStats: true } },
    },
  });
  for (const match of existingDbMatches) {
    if (match.championDataMatchId) {
      existingMatches.set(match.championDataMatchId, {
        status: match.status,
        playerStats: match._count.playerStats,
      });
    }
  }

  for (const matchData of fixture) {
    const cdStatus = matchData.matchStatus.toLowerCase();
    const isPlaying = cdStatus === 'playing';
    const existing = existingMatches.get(matchData.matchId);
    const needsCompletedBackfill = cdStatus === 'complete' && (
      existing === undefined ||
      existing.status === 'SCHEDULED' ||
      existing.status === 'LIVE' ||
      existing.playerStats === 0
    );
    if (!isPlaying && !needsCompletedBackfill) continue;

    // The ordering token is request start, not response completion. Otherwise
    // an older slow request can finish last and masquerade as a newer source
    // observation across worker processes.
    const detailObservationAt = new Date();
    try {
      const detail = await fetchMatchStats(competitionId, matchData.matchId);
      matchDetails.set(matchData.matchId, detail);
      const log = await prisma.pollLog.create({
        data: {
          competitionId,
          polledAt: detailObservationAt,
          cdMatchId: matchData.matchId,
          endpoint: 'match-detail',
          rawResponse: detail as unknown as Prisma.InputJsonValue,
          status: 'success',
        },
      });
      pollLogIds.push(log.id);
      matchPollLogIds.set(matchData.matchId, log.id);
    } catch (error) {
      detailFetchErrors++;
      await prisma.pollLog.create({
        data: {
          competitionId,
          polledAt: detailObservationAt,
          cdMatchId: matchData.matchId,
          endpoint: 'match-detail',
          rawResponse: {},
          status: 'fetch_error',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return {
    fixture,
    fixtureObservationAt,
    matchDetails,
    pollLogIds,
    matchPollLogIds,
    detailFetchErrors,
  };
}
