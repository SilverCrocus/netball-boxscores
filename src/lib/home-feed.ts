import type { Prisma } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import { prisma, excludeSimData } from '@/lib/db';
import { formatMatchStage } from '@/lib/match-label';
import { hasResolvedMatchTeams, type ResolvedMatchTeams } from '@/lib/edition-match';
import { isFinalFixture, resolveEditionFeatures } from '@/lib/edition-capabilities';

export const HOME_RESULTS_PAGE_SIZE = 8;

export const homepageMatchSelect = {
  id: true,
  competitionId: true,
  status: true,
  resultQuality: true,
  scheduledAt: true,
  homeScore: true,
  awayScore: true,
  venue: true,
  round: true,
  roundLabel: true,
  finalCode: true,
  stage: { select: { name: true } },
  currentQuarter: true,
  currentTime: true,
  homeTeamId: true,
  awayTeamId: true,
  homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
  awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
  competition: {
    select: {
      dataCoverage: {
        where: { matchId: null },
        select: { capability: true, state: true },
      },
    },
  },
  dataCoverage: { select: { capability: true, state: true } },
  teamStats: { select: { teamId: true, goals: true, goal2: true } },
} satisfies Prisma.MatchSelect;

export type HomepageMatch = Prisma.MatchGetPayload<{ select: typeof homepageMatchSelect }>;
export type ResolvedHomepageMatch = ResolvedMatchTeams<HomepageMatch>;

interface ScoreBreakdown {
  goals: number;
  superShots: number;
}

export interface HomeResultCard {
  id: string;
  competitionId?: string;
  href?: string;
  status: 'COMPLETED';
  scoreAvailable: boolean;
  scheduledAt: string;
  homeScore: number;
  awayScore: number;
  venue: string;
  round: number | null;
  roundLabel: string | null;
  stageName: string | null;
  finalCode: string | null;
  homeTeam: NonNullable<HomepageMatch['homeTeam']>;
  awayTeam: NonNullable<HomepageMatch['awayTeam']>;
  homeBreakdown: ScoreBreakdown | null;
  awayBreakdown: ScoreBreakdown | null;
}

export interface HomeResultGroup {
  label: string;
  matches: HomeResultCard[];
}

export interface CompletedMatchesPage {
  groups: HomeResultGroup[];
  nextCursor: string | null;
}

interface CompletedCursor {
  scheduledAt: string;
  id: string;
}

export function computeBreakdown(match: HomepageMatch) {
  const features = resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage);
  if (!features.superShots.available) {
    return { homeBreakdown: null, awayBreakdown: null };
  }

  const home = match.teamStats.find((stat) => stat.teamId === match.homeTeamId);
  const away = match.teamStats.find((stat) => stat.teamId === match.awayTeamId);
  const hasSuperShots = (home?.goal2 ?? 0) > 0 || (away?.goal2 ?? 0) > 0;

  return {
    homeBreakdown: hasSuperShots && home
      ? { goals: Math.max(0, home.goals - home.goal2), superShots: home.goal2 }
      : null,
    awayBreakdown: hasSuperShots && away
      ? { goals: Math.max(0, away.goals - away.goal2), superShots: away.goal2 }
      : null,
  };
}

export function isHomepageScoreAvailable(match: HomepageMatch): boolean {
  const features = resolveEditionFeatures(match.competition.dataCoverage, match.dataCoverage);
  return features.finalScore.available
    && (match.status === 'LIVE' || isFinalFixture(match.status, match.resultQuality));
}

function toResultCard(match: ResolvedHomepageMatch): HomeResultCard {
  return {
    id: match.id,
    competitionId: match.competitionId,
    status: 'COMPLETED',
    scoreAvailable: true,
    scheduledAt: match.scheduledAt.toISOString(),
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    venue: match.venue,
    round: match.round,
    roundLabel: match.roundLabel,
    stageName: match.stage?.name ?? null,
    finalCode: match.finalCode,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    ...computeBreakdown(match),
  };
}

export function groupCompletedMatches(matches: HomepageMatch[]): HomeResultGroup[] {
  const grouped = new Map<string, HomeResultCard[]>();

  for (const match of matches) {
    if (!hasResolvedMatchTeams(match) || !isHomepageScoreAvailable(match)) continue;
    const label = formatMatchStage(match.round, match.finalCode, match.roundLabel, match.stage?.name);
    const group = grouped.get(label) ?? [];
    group.push(toResultCard(match));
    grouped.set(label, group);
  }

  return Array.from(grouped, ([label, groupMatches]) => ({
    label,
    matches: groupMatches.toSorted(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    ),
  }));
}

export function encodeCompletedCursor(match: Pick<HomepageMatch, 'scheduledAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({
    scheduledAt: match.scheduledAt.toISOString(),
    id: match.id,
  } satisfies CompletedCursor)).toString('base64url');
}

export function decodeCompletedCursor(cursor: string): CompletedCursor | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CompletedCursor>;
    if (typeof value.id !== 'string' || typeof value.scheduledAt !== 'string') return null;
    if (Number.isNaN(new Date(value.scheduledAt).getTime())) return null;
    return { id: value.id, scheduledAt: value.scheduledAt };
  } catch {
    return null;
  }
}

export async function loadCompletedMatchesPage(
  competitionId: string,
  cursor?: string,
): Promise<CompletedMatchesPage> {
  const decodedCursor = cursor ? decodeCompletedCursor(cursor) : null;
  if (cursor && !decodedCursor) {
    throw new Error('INVALID_CURSOR');
  }

  const cursorDate = decodedCursor ? new Date(decodedCursor.scheduledAt) : null;
  const matches = await prisma.match.findMany({
    where: {
      ...excludeSimData,
      competitionId,
      status: 'COMPLETED',
      resultQuality: { in: ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'] },
      homeTeamId: { not: null },
      awayTeamId: { not: null },
      ...(cursorDate && decodedCursor
        ? {
            OR: [
              { scheduledAt: { lt: cursorDate } },
              { scheduledAt: cursorDate, id: { lt: decodedCursor.id } },
            ],
          }
        : {}),
    },
    select: homepageMatchSelect,
    orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
    take: HOME_RESULTS_PAGE_SIZE + 1,
  });

  const pageMatches = matches.filter(hasResolvedMatchTeams).slice(0, HOME_RESULTS_PAGE_SIZE);
  const hasMore = matches.length > HOME_RESULTS_PAGE_SIZE;
  const lastMatch = pageMatches.at(-1);

  return {
    groups: groupCompletedMatches(pageMatches),
    nextCursor: hasMore && lastMatch ? encodeCompletedCursor(lastMatch) : null,
  };
}

export const getCompletedMatchesPage = process.env.NODE_ENV === 'test'
  ? loadCompletedMatchesPage
  : unstable_cache(loadCompletedMatchesPage, ['completed-home-results-v1'], {
      revalidate: 900,
      tags: ['completed-match-history'],
    });

export interface HomeHeaderState {
  eyebrow: string;
  heading: string;
  description: string | null;
}

export function deriveHomeHeader(
  season: number | null,
  liveMatches: HomepageMatch[],
  upcomingMatches: HomepageMatch[],
  resultGroups: HomeResultGroup[],
): HomeHeaderState {
  if (liveMatches.length > 0) {
    return {
      eyebrow: 'Game Day Hub',
      heading: 'LIVE NOW',
      description: `${liveMatches.length} ${liveMatches.length === 1 ? 'match is' : 'matches are'} in progress.`,
    };
  }

  if (upcomingMatches.length > 0) {
    return {
      eyebrow: 'Next Round',
      heading: 'UPCOMING',
      description: 'The next fixtures are ready below.',
    };
  }

  const grandFinal = resultGroups
    .flatMap((group) => group.matches)
    .find((match) => match.finalCode === 'GRAND');
  if (grandFinal) {
    const champion = grandFinal.homeScore > grandFinal.awayScore
      ? grandFinal.homeTeam.name
      : grandFinal.awayTeam.name;
    return {
      eyebrow: season ? `Season ${season} Complete` : 'Season Complete',
      heading: 'CHAMPIONS CROWNED',
      description: `${champion} won the Grand Final ${grandFinal.homeScore}-${grandFinal.awayScore}.`,
    };
  }

  if (resultGroups.length > 0) {
    return {
      eyebrow: season ? `Season ${season}` : 'Latest Season',
      heading: 'LATEST RESULTS',
      description: 'Catch up on the most recent round.',
    };
  }

  return {
    eyebrow: season ? `Season ${season}` : 'Latest Season',
    heading: 'FIXTURES COMING SOON',
    description: null,
  };
}
