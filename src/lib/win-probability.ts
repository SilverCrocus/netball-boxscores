import { prisma, excludeSimData } from '@/lib/db';
import { getPublicCompetitions } from '@/lib/competitions';
import { isFinalFixture } from '@/lib/edition-capabilities';
import {
  canExposePublicMatchScore,
  resolvePublicMatchAccessBatch,
} from '@/lib/public-match';
const TEAM_STRENGTH_HISTORY_LIMIT = 200;

export { calculateWinProbability } from '@/lib/win-probability-client';
export type {
  PreMatchPrior,
  WinProbabilityInput,
  WinProbabilityResult,
} from '@/lib/win-probability-client';
import type { PreMatchPrior } from '@/lib/win-probability-client';

export async function computeTeamStrengthPrior(
  homeTeamId: string,
  awayTeamId: string,
  currentMatchId: string,
): Promise<PreMatchPrior | null> {
  const publicEditions = await getPublicCompetitions();
  const publicEditionIds = publicEditions.map((edition) => edition.id);
  if (publicEditionIds.length === 0) return null;

  const completedMatches = await prisma.match.findMany({
    where: {
      ...excludeSimData,
      status: 'COMPLETED',
      competitionId: { in: publicEditionIds },
      resultQuality: { in: ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'] },
      id: { not: currentMatchId },
      AND: [
        {
          OR: [
            { homeTeamId: { in: [homeTeamId, awayTeamId] } },
            { awayTeamId: { in: [homeTeamId, awayTeamId] } },
          ],
        },
        {
          OR: [
            { stageId: null },
            { stage: { is: { isPublished: true } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
    orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
    take: TEAM_STRENGTH_HISTORY_LIMIT,
  });

  const accessByMatch = await resolvePublicMatchAccessBatch(
    completedMatches.map((match) => match.id),
    publicEditions,
  );
  const accessibleMatches = completedMatches.filter((match) => {
    const access = accessByMatch.get(match.id);
    return Boolean(access
      && isFinalFixture(access.status, access.resultQuality)
      && canExposePublicMatchScore(access));
  });

  let homeGoalsFor = 0, homeGoalsAgainst = 0, homeGames = 0;
  let awayGoalsFor = 0, awayGoalsAgainst = 0, awayGames = 0;

  for (const m of accessibleMatches) {
    if (m.homeTeamId === homeTeamId) {
      homeGoalsFor += m.homeScore;
      homeGoalsAgainst += m.awayScore;
      homeGames++;
    } else if (m.awayTeamId === homeTeamId) {
      homeGoalsFor += m.awayScore;
      homeGoalsAgainst += m.homeScore;
      homeGames++;
    }
    if (m.homeTeamId === awayTeamId) {
      awayGoalsFor += m.homeScore;
      awayGoalsAgainst += m.awayScore;
      awayGames++;
    } else if (m.awayTeamId === awayTeamId) {
      awayGoalsFor += m.awayScore;
      awayGoalsAgainst += m.homeScore;
      awayGames++;
    }
  }

  if (homeGames < 3 || awayGames < 3) return null;

  const homeAvgGoals = homeGoalsFor / homeGames;
  const awayAvgGoals = awayGoalsFor / awayGames;
  const homeAvgConceded = homeGoalsAgainst / homeGames;
  const awayAvgConceded = awayGoalsAgainst / awayGames;

  // Expected margin: home's expected scoring - away's expected scoring
  // Each team's expected score = avg of (their attack vs opponent's defence)
  const homeExpected = (homeAvgGoals + awayAvgConceded) / 2;
  const awayExpected = (awayAvgGoals + homeAvgConceded) / 2;
  const expectedMargin = homeExpected - awayExpected;

  return { expectedMargin, homeAvgGoals: homeExpected, awayAvgGoals: awayExpected };
}
