import type { Prisma } from '@prisma/client';
import { unstable_cache } from 'next/cache';
import { prisma, excludeSimData } from '@/lib/db';
import { formatMatchStage } from '@/lib/match-label';
import { hasResolvedMatchTeams, type ResolvedMatchTeams } from '@/lib/edition-match';
import { isFinalFixture, resolveEditionFeatures } from '@/lib/edition-capabilities';
import type { EditionSchedule } from '@/lib/edition-schedule';
import { matchHref } from '@/lib/edition-links';
import {
  canExposePublicMatchScore,
  resolvePublicMatchAccessBatch,
  type PublicMatchAccess,
} from '@/lib/public-match';
import type { CompetitionOption } from '@/lib/competitions';

export const HOME_RESULTS_PAGE_SIZE = 8;
export const HOME_UPCOMING_FIXTURE_LIMIT = 5;
const COMPLETED_RESULTS_MAX_SCAN_BATCHES = 8;
const COMPLETED_RESULTS_SCAN_LIMIT = (
  HOME_RESULTS_PAGE_SIZE + 1
) * COMPLETED_RESULTS_MAX_SCAN_BATCHES;

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

const homepageMatchHydrationSelect = {
  ...homepageMatchSelect,
  sourceUpdatedAt: true,
} satisfies Prisma.MatchSelect;

interface CachedCompletedMatchCandidate {
  id: string;
  scheduledAt: string;
}

interface CompletedMatchCandidate {
  id: string;
  scheduledAt: Date;
}

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
  upcomingFixtures?: HomeUpcomingFixtureCard[];
}

export interface HomeUpcomingFixtureCard {
  id: string;
  competitionId: string;
  href: string;
  status: 'SCHEDULED';
  scheduledAt: string;
  venue: string;
  homeTeam: NonNullable<HomepageMatch['homeTeam']>;
  awayTeam: NonNullable<HomepageMatch['awayTeam']>;
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

/**
 * Build the score-bearing portion of a public card from current access rather
 * than trusting potentially cached match coverage or lifecycle fields.
 */
export function publicHomepageMatchState(
  match: HomepageMatch,
  access: PublicMatchAccess,
) {
  const scoreAvailable = canExposePublicMatchScore(access);
  const clockAvailable = scoreAvailable && access.status === 'LIVE';
  const breakdown = scoreAvailable && access.features.superShots.available
    ? computeBreakdown(match)
    : { homeBreakdown: null, awayBreakdown: null };

  return {
    status: access.status,
    scoreAvailable,
    homeScore: scoreAvailable ? match.homeScore : null,
    awayScore: scoreAvailable ? match.awayScore : null,
    currentQuarter: clockAvailable ? match.currentQuarter : null,
    currentTime: clockAvailable ? match.currentTime : null,
    ...breakdown,
  };
}

function toResultCard(
  match: ResolvedHomepageMatch,
  access?: PublicMatchAccess,
): HomeResultCard {
  const breakdown = access && !access.features.superShots.available
    ? { homeBreakdown: null, awayBreakdown: null }
    : computeBreakdown(match);

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
    ...breakdown,
  };
}

export function groupCompletedMatches(
  matches: HomepageMatch[],
  currentAccess?: ReadonlyMap<string, PublicMatchAccess>,
): HomeResultGroup[] {
  const grouped = new Map<string, HomeResultCard[]>();

  for (const match of matches) {
    const access = currentAccess?.get(match.id);
    const scoreAvailable = currentAccess
      ? Boolean(access && canExposePublicMatchScore(access))
      : isHomepageScoreAvailable(match);
    if (!hasResolvedMatchTeams(match) || !scoreAvailable) continue;
    const label = formatMatchStage(match.round, match.finalCode, match.roundLabel, match.stage?.name);
    const group = grouped.get(label) ?? [];
    group.push(toResultCard(match, access));
    grouped.set(label, group);
  }

  return Array.from(grouped, ([label, groupMatches]) => ({
    label,
    matches: groupMatches.toSorted(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    ),
  }));
}

/**
 * Project the small public fixture slice needed by the homepage. The edition
 * schedule remains the source of truth for slot resolution and publication;
 * unresolved bracket slots are never presented as named teams.
 */
export function buildHomeUpcomingFixtures(
  schedule: EditionSchedule,
  now = new Date(),
): HomeUpcomingFixtureCard[] {
  return schedule.stages
    .flatMap((stage) => stage.dates.flatMap((date) => date.fixtures))
    .filter((fixture) => fixture.status === 'SCHEDULED'
      && fixture.scheduledAt.getTime() >= now.getTime()
      && fixture.sideA.resolved
      && fixture.sideA.team !== null
      && fixture.sideB.resolved
      && fixture.sideB.team !== null)
    .toSorted((left, right) =>
      left.scheduledAt.getTime() - right.scheduledAt.getTime()
        || left.id.localeCompare(right.id)
    )
    .slice(0, HOME_UPCOMING_FIXTURE_LIMIT)
    .map((fixture) => ({
      id: fixture.id,
      competitionId: schedule.editionId,
      href: matchHref(fixture.id, schedule.editionId),
      status: 'SCHEDULED',
      scheduledAt: fixture.scheduledAt.toISOString(),
      venue: fixture.venue,
      homeTeam: {
        name: fixture.sideA.team!.name,
        abbreviation: fixture.sideA.team!.abbreviation,
        logoUrl: fixture.sideA.team!.logoUrl,
      },
      awayTeam: {
        name: fixture.sideB.team!.name,
        abbreviation: fixture.sideB.team!.abbreviation,
        logoUrl: fixture.sideB.team!.logoUrl,
      },
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

async function loadCompletedMatchCandidates(
  competitionId: string,
  cursor?: string,
): Promise<CachedCompletedMatchCandidate[]> {
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
      AND: [
        {
          OR: [
            { stageId: null },
            { stage: { is: { isPublished: true } } },
          ],
        },
        ...(cursorDate && decodedCursor
          ? [{
            OR: [
              { scheduledAt: { lt: cursorDate } },
              { scheduledAt: cursorDate, id: { lt: decodedCursor.id } },
            ],
          }]
          : []),
      ],
    },
    select: { id: true, scheduledAt: true },
    orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
    take: COMPLETED_RESULTS_SCAN_LIMIT + 1,
  });

  return matches.map((match) => ({
    id: match.id,
    scheduledAt: match.scheduledAt.toISOString(),
  }));
}

const getCachedCompletedMatchCandidates = process.env.NODE_ENV === 'test'
  ? loadCompletedMatchCandidates
  : unstable_cache(loadCompletedMatchCandidates, ['completed-home-result-candidates-v4'], {
      revalidate: 900,
      tags: ['completed-match-history'],
    });

async function getCompletedMatchCandidates(
  competitionId: string,
  cursor?: string,
): Promise<CompletedMatchCandidate[]> {
  const matches = await getCachedCompletedMatchCandidates(competitionId, cursor);
  return matches.map((match) => ({
    ...match,
    scheduledAt: new Date(match.scheduledAt),
  }));
}

function isCurrentCompletedResultAccess(access: PublicMatchAccess): boolean {
  return isFinalFixture(access.status, access.resultQuality)
    && canExposePublicMatchScore(access);
}

export async function loadCompletedMatchesPage(
  competitionId: string,
  cursor?: string,
  loadedEditions?: readonly CompetitionOption[],
): Promise<CompletedMatchesPage> {
  const candidates = await getCompletedMatchCandidates(competitionId, cursor);
  const reachedEnd = candidates.length <= COMPLETED_RESULTS_SCAN_LIMIT;
  const scannedCandidates = candidates.slice(0, COMPLETED_RESULTS_SCAN_LIMIT);
  const candidateIds = scannedCandidates.map((match) => match.id);
  const currentMatches = candidateIds.length > 0
    ? await prisma.match.findMany({
        where: {
          ...excludeSimData,
          competitionId,
          id: { in: candidateIds },
        },
        select: homepageMatchHydrationSelect,
      })
    : [];
  const currentAccess = await resolvePublicMatchAccessBatch(
    candidateIds,
    loadedEditions,
  );
  const currentMatchById = new Map(currentMatches.map((match) => [match.id, match]));
  const candidateById = new Map(scannedCandidates.map((match) => [match.id, match]));
  const eligibleMatches = scannedCandidates.flatMap((candidate) => {
    const match = currentMatchById.get(candidate.id);
    const access = currentAccess.get(candidate.id);
    const sameRevision = match && access
      ? match.sourceUpdatedAt?.getTime() === access.sourceUpdatedAt?.getTime()
      : false;
    return match
      && access
      && sameRevision
      && isCurrentCompletedResultAccess(access)
      && hasResolvedMatchTeams(match)
      ? [match]
      : [];
  });

  const pageMatches = eligibleMatches.slice(0, HOME_RESULTS_PAGE_SIZE);
  const lastPageMatch = pageMatches.at(-1);
  const lastPageCandidate = lastPageMatch
    ? candidateById.get(lastPageMatch.id)
    : undefined;
  const lastScannedMatch = scannedCandidates.at(-1);
  const nextCursor = eligibleMatches.length > HOME_RESULTS_PAGE_SIZE && lastPageCandidate
    ? encodeCompletedCursor(lastPageCandidate)
    : !reachedEnd && lastScannedMatch
      ? encodeCompletedCursor(lastScannedMatch)
      : null;

  return {
    groups: groupCompletedMatches(pageMatches, currentAccess),
    nextCursor,
  };
}

/** Only stable candidate IDs/order are cached; card data and access are always fresh. */
export const getCompletedMatchesPage = loadCompletedMatchesPage;

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
