import type { Prisma } from '@prisma/client';
import { prisma, excludeSimData } from '@/lib/db';
import { homepageMatchSelect } from '@/lib/home-feed';
import { getSydneyDayBounds } from '@/lib/time-zone';
import {
  publicMatchBatchSelect,
  resolvePublicMatchAccessBatch,
  type PublicMatchAccess,
  type PublicMatchAccessCandidate,
} from '@/lib/public-match';
import { timedQuery } from '@/lib/server-timing';

export const MAX_LIVE_STATE_CANDIDATES = 128;

export const liveMatchSelect = {
  ...homepageMatchSelect,
  isSimulation: true,
  sourceUpdatedAt: true,
  stageId: true,
  stage: { select: { name: true, isPublished: true } },
} satisfies Prisma.MatchSelect;

export type LiveMatch = Prisma.MatchGetPayload<{ select: typeof liveMatchSelect }>;

export interface LiveMatchDetail {
  match: LiveMatch;
  access: PublicMatchAccess;
}

export interface LiveState {
  liveMatches: Array<{ id: string; competitionId: string }>;
  liveMatchIds: string[];
  imminentMatchIds: string[];
  nextMatchAt: Date | null;
  isMatchDay: boolean;
  liveMatchDetails?: LiveMatchDetail[];
}

export interface LiveStatusState {
  hasLive: boolean;
  nextMatchAt: Date | null;
}

interface LiveStateOptions {
  includeMatchDetails?: boolean;
  includeWindowCandidates?: boolean;
}

export async function getLiveState(
  options: LiveStateOptions = {},
): Promise<LiveState> {
  const now = new Date();
  const sixtyMinsAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sixtyMinsFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const { start: startOfSydneyDay, end: endOfSydneyDay } = getSydneyDayBounds(now);
  const candidateWindowStart = new Date(Math.min(
    startOfSydneyDay.getTime(),
    sixtyMinsAgo.getTime(),
  ));
  const candidateWindowEnd = new Date(Math.max(
    endOfSydneyDay.getTime(),
    sixtyMinsFromNow.getTime(),
  ));

  const candidateSelect = options.includeMatchDetails ? liveMatchSelect : publicMatchBatchSelect;
  const liveCandidates = await timedQuery(
    'live_active_candidates',
    () => prisma.match.findMany({
      where: {
        ...excludeSimData,
        status: 'LIVE',
      },
      select: candidateSelect,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: MAX_LIVE_STATE_CANDIDATES,
    }),
  );
  const remainingCandidateCount = Math.max(
    0,
    MAX_LIVE_STATE_CANDIDATES - liveCandidates.length,
  );
  const liveCandidateIds = liveCandidates.map((match) => match.id);
  const windowCandidates = options.includeWindowCandidates !== false && remainingCandidateCount > 0
    ? await timedQuery(
      'live_window_candidates',
      () => prisma.match.findMany({
        where: {
          ...excludeSimData,
          status: { not: 'LIVE' },
          scheduledAt: { gte: candidateWindowStart, lt: candidateWindowEnd },
          ...(liveCandidateIds.length > 0
            ? { id: { notIn: liveCandidateIds } }
            : {}),
        },
        select: candidateSelect,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: remainingCandidateCount,
      }),
    )
    : [];
  const candidates = [...liveCandidates, ...windowCandidates];

  const accessById = await resolvePublicMatchAccessBatch(
    candidates.map((match) => match.id),
    undefined,
    options.includeMatchDetails
      ? candidates as unknown as PublicMatchAccessCandidate[]
      : undefined,
  ).catch(() => new Map<string, PublicMatchAccess>());
  const publicCandidates = candidates.flatMap((match) => {
    const access = accessById.get(match.id);
    return access ? [{ match, access }] : [];
  });

  const liveMatches = publicCandidates
    .filter(({ access }) => access.status === 'LIVE')
    .map(({ match }) => ({ id: match.id, competitionId: match.competitionId }));
  const imminentMatches = publicCandidates.filter(({ match, access }) =>
    access.status === 'SCHEDULED'
      && match.scheduledAt >= sixtyMinsAgo
      && match.scheduledAt <= sixtyMinsFromNow
  );
  const nextMatch = publicCandidates
    .filter(({ match, access }) =>
      access.status === 'SCHEDULED'
        && match.scheduledAt >= now
        && match.scheduledAt <= sixtyMinsFromNow
    )
    .toSorted((left, right) => left.match.scheduledAt.getTime() - right.match.scheduledAt.getTime())[0];
  const isMatchDay = publicCandidates.some(({ match }) =>
    match.scheduledAt >= startOfSydneyDay && match.scheduledAt < endOfSydneyDay
  );
  const liveMatchDetails = options.includeMatchDetails
    ? liveMatches.flatMap(({ id }) => {
      const candidate = publicCandidates.find(({ match }) => match.id === id);
      return candidate ? [{ match: candidate.match as LiveMatch, access: candidate.access }] : [];
    })
    : undefined;

  return {
    liveMatches,
    liveMatchIds: liveMatches.map((m) => m.id),
    imminentMatchIds: imminentMatches.map(({ match }) => match.id),
    nextMatchAt: nextMatch?.match.scheduledAt ?? null,
    isMatchDay,
    ...(liveMatchDetails ? { liveMatchDetails } : {}),
  };
}

/**
 * The shared navigation badge needs only current live rows and the next hour.
 * Keep this uncached: a stale score-state snapshot is worse than a cheap
 * request, and the page-level loader still owns the richer match-day facts.
 */
export async function getLiveStatus(): Promise<LiveStatusState> {
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const [liveCandidates, upcomingCandidates] = await Promise.all([
    timedQuery(
      'live_status_active_candidates',
      () => prisma.match.findMany({
        where: {
          ...excludeSimData,
          status: 'LIVE',
        },
        select: publicMatchBatchSelect,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: MAX_LIVE_STATE_CANDIDATES,
      }),
    ),
    timedQuery(
      'live_status_upcoming_candidates',
      () => prisma.match.findMany({
        where: {
          ...excludeSimData,
          status: 'SCHEDULED',
          scheduledAt: { gte: now, lte: nextHour },
        },
        select: publicMatchBatchSelect,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: MAX_LIVE_STATE_CANDIDATES,
      }),
    ),
  ]);
  const mergedCandidates = [
    ...new Map(
      [...liveCandidates, ...upcomingCandidates].map((match) => [match.id, match]),
    ).values(),
  ];
  const candidateIds = mergedCandidates.map((match) => match.id);
  const candidates = candidateIds.length > 0
    ? await timedQuery(
      'live_status_authoritative_candidates',
      () => prisma.match.findMany({
        where: {
          ...excludeSimData,
          id: { in: candidateIds },
        },
        select: publicMatchBatchSelect,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: candidateIds.length,
      }),
    )
    : [];
  const accessById = await resolvePublicMatchAccessBatch(
    candidates.map((match) => match.id),
    undefined,
    candidates as unknown as PublicMatchAccessCandidate[],
  ).catch(() => new Map<string, PublicMatchAccess>());

  const hasLive = candidates.some((match) => accessById.get(match.id)?.status === 'LIVE');
  const nextMatchAt = candidates
    .flatMap((match) => {
      const access = accessById.get(match.id);
      return access?.status === 'SCHEDULED'
        && match.scheduledAt >= now
        && match.scheduledAt <= nextHour
        ? [match.scheduledAt]
        : [];
    })
    .toSorted((left, right) => left.getTime() - right.getTime())[0] ?? null;

  return { hasLive, nextMatchAt };
}
