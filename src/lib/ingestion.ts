import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats } from '@/lib/champion-data';
import type { Prisma } from '@prisma/client';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

export interface IngestedData {
  fixture: CDFixtureMatch[];
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
  try {
    fixture = await fetchFixture(competitionId);
    const log = await prisma.pollLog.create({
      data: {
        competitionId,
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
        endpoint: 'fixture',
        rawResponse: {},
        status: 'fetch_error',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  // Determine which matches need detail fetching
  const scheduledCDIds = new Set<number>();
  const scheduledDbMatches = await prisma.match.findMany({
    where: { status: 'SCHEDULED', championDataMatchId: { not: null } },
    select: { championDataMatchId: true },
  });
  for (const m of scheduledDbMatches) {
    if (m.championDataMatchId) scheduledCDIds.add(m.championDataMatchId);
  }

  const liveCDIds = new Set<number>();
  const liveDbMatches = await prisma.match.findMany({
    where: { status: 'LIVE', championDataMatchId: { not: null } },
    select: { championDataMatchId: true },
  });
  for (const m of liveDbMatches) {
    if (m.championDataMatchId) liveCDIds.add(m.championDataMatchId);
  }

  for (const matchData of fixture) {
    const cdStatus = matchData.matchStatus.toLowerCase();
    const isPlaying = cdStatus === 'playing';
    const needsBackfill =
      cdStatus === 'complete' && scheduledCDIds.has(matchData.matchId);
    const needsFinalFetch =
      cdStatus === 'complete' && liveCDIds.has(matchData.matchId);
    if (!isPlaying && !needsBackfill && !needsFinalFetch) continue;

    try {
      const detail = await fetchMatchStats(competitionId, matchData.matchId);
      matchDetails.set(matchData.matchId, detail);
      const log = await prisma.pollLog.create({
        data: {
          competitionId,
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
          cdMatchId: matchData.matchId,
          endpoint: 'match-detail',
          rawResponse: {},
          status: 'fetch_error',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return { fixture, matchDetails, pollLogIds, matchPollLogIds, detailFetchErrors };
}
