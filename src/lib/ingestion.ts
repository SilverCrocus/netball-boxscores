import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats } from '@/lib/champion-data';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

export interface IngestedData {
  fixture: CDFixtureMatch[];
  matchDetails: Map<number, CDMatchStatsResponse>;
  pollLogIds: string[];
}

export async function ingestFromChampionData(
  competitionId: number,
): Promise<IngestedData> {
  const pollLogIds: string[] = [];
  const matchDetails = new Map<number, CDMatchStatsResponse>();

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
        rawResponse: fixture as any,
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
    return { fixture: [], matchDetails, pollLogIds };
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

  for (const matchData of fixture) {
    const cdStatus = matchData.matchStatus.toLowerCase();
    const isPlaying = cdStatus === 'playing';
    const needsBackfill =
      cdStatus === 'complete' && scheduledCDIds.has(matchData.matchId);
    if (!isPlaying && !needsBackfill) continue;

    try {
      const detail = await fetchMatchStats(competitionId, matchData.matchId);
      matchDetails.set(matchData.matchId, detail);
      const log = await prisma.pollLog.create({
        data: {
          competitionId,
          cdMatchId: matchData.matchId,
          endpoint: 'match-detail',
          rawResponse: detail as any,
          status: 'success',
        },
      });
      pollLogIds.push(log.id);
    } catch (error) {
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

  return { fixture, matchDetails, pollLogIds };
}
