import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type {
  MatchTimelineEntry,
  MatchTimelineEventType,
  MatchTimelineResponse,
} from '@/types/match-timeline';
import { secondaryPlayerPhotoUrl } from '@/lib/player-photo';
import {
  isPublicMatchLiveOrFinal,
  resolvePublicMatchAccess,
} from '@/lib/public-match';

export const MATCH_TIMELINE_PAGE_SIZE = 75;

interface TimelineCursor {
  period: number;
  periodSeconds: number;
  source: 'score' | 'event';
  id: string;
}

export interface MatchTimelineFilters {
  cursor?: string;
  eventType?: MatchTimelineEventType;
  limit?: number;
  quarter?: number;
  teamId?: string;
}

interface SortableTimelineEntry extends MatchTimelineEntry {
  source: TimelineCursor['source'];
}

function cursorFor(entry: SortableTimelineEntry): TimelineCursor {
  return {
    period: entry.period,
    periodSeconds: entry.periodSeconds,
    source: entry.source,
    id: entry.id,
  };
}

function compareNewest(a: TimelineCursor, b: TimelineCursor): number {
  if (a.period !== b.period) return b.period - a.period;
  if (a.periodSeconds !== b.periodSeconds) return b.periodSeconds - a.periodSeconds;
  if (a.source !== b.source) return a.source === 'score' ? -1 : 1;
  return b.id.localeCompare(a.id);
}

export function encodeTimelineCursor(entry: TimelineCursor): string {
  return Buffer.from(JSON.stringify(entry)).toString('base64url');
}

export function decodeTimelineCursor(cursor: string): TimelineCursor | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<TimelineCursor>;
    if (!Number.isInteger(value.period) || !Number.isInteger(value.periodSeconds)) return null;
    if (value.source !== 'score' && value.source !== 'event') return null;
    if (typeof value.id !== 'string' || value.id.length === 0) return null;
    return value as TimelineCursor;
  } catch {
    return null;
  }
}

export async function loadMatchTimeline(
  matchId: string,
  filters: MatchTimelineFilters = {},
): Promise<MatchTimelineResponse> {
  const cursor = filters.cursor ? decodeTimelineCursor(filters.cursor) : null;
  if (filters.cursor && !cursor) throw new Error('INVALID_CURSOR');

  const access = await resolvePublicMatchAccess(matchId);
  if (!access) throw new Error('MATCH_NOT_FOUND');

  const scoreFlowAvailable = access.features.scoreFlow.available;
  const matchEventsAvailable = access.features.matchEvents.available;
  if (!isPublicMatchLiveOrFinal(access) || (!scoreFlowAvailable && !matchEventsAvailable)) {
    return { entries: [], nextCursor: null };
  }

  const limit = Math.min(Math.max(filters.limit ?? MATCH_TIMELINE_PAGE_SIZE, 1), MATCH_TIMELINE_PAGE_SIZE);
  const olderThanCursor = cursor
    ? {
        OR: [
          { period: { lt: cursor.period } },
          { period: cursor.period, periodSeconds: { lte: cursor.periodSeconds } },
        ],
      }
    : {};
  const scoreWhere = {
    matchId,
    ...(filters.quarter ? { period: filters.quarter } : {}),
    ...(filters.teamId ? { scoringTeamId: filters.teamId } : {}),
    ...olderThanCursor,
  } satisfies Prisma.ScoreFlowWhereInput;
  const eventWhere = {
    matchId,
    ...(filters.quarter ? { period: filters.quarter } : {}),
    ...(filters.teamId ? { teamId: filters.teamId } : {}),
    ...(filters.eventType && filters.eventType !== 'goal' ? { type: filters.eventType } : {}),
    ...olderThanCursor,
  } satisfies Prisma.MatchEventWhereInput;

  const [scores, events] = await Promise.all([
    !scoreFlowAvailable || (filters.eventType && filters.eventType !== 'goal')
      ? Promise.resolve([])
      : prisma.scoreFlow.findMany({
          where: scoreWhere,
          select: {
            id: true,
            period: true,
            periodSeconds: true,
            scoringTeamId: true,
            homeScore: true,
            awayScore: true,
            scorePoints: true,
            scorerPlayer: {
              select: {
                id: true,
                name: true,
                photoUrl: true,
                photoSourceUrl: true,
                photoCredit: true,
                photoLicense: true,
              },
            },
          },
          orderBy: [{ period: 'desc' }, { periodSeconds: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        }),
    !matchEventsAvailable || filters.eventType === 'goal'
      ? Promise.resolve([])
      : prisma.matchEvent.findMany({
          where: eventWhere,
          select: {
            id: true,
            period: true,
            periodSeconds: true,
            type: true,
            teamId: true,
            player: {
              select: {
                id: true,
                name: true,
                photoUrl: true,
                photoSourceUrl: true,
                photoCredit: true,
                photoLicense: true,
              },
            },
          },
          orderBy: [{ period: 'desc' }, { periodSeconds: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        }),
  ]);

  const combined: SortableTimelineEntry[] = [
    ...scores.map((score) => ({
      id: score.id,
      source: 'score' as const,
      period: score.period,
      periodSeconds: score.periodSeconds,
      eventType: 'goal' as const,
      teamId: score.scoringTeamId,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
      scorePoints: score.scorePoints,
      playerId: score.scorerPlayer?.id,
      playerName: score.scorerPlayer?.name,
      playerPhotoUrl: score.scorerPlayer
        ? secondaryPlayerPhotoUrl(score.scorerPlayer)
        : null,
    })),
    ...events.map((event) => ({
      id: event.id,
      source: 'event' as const,
      period: event.period,
      periodSeconds: event.periodSeconds,
      eventType: event.type as MatchTimelineEventType,
      teamId: event.teamId,
      playerId: event.player.id,
      playerName: event.player.name,
      playerPhotoUrl: secondaryPlayerPhotoUrl(event.player),
    })),
  ]
    .filter((entry) => !cursor || compareNewest(cursorFor(entry), cursor) > 0)
    .sort((a, b) => compareNewest(cursorFor(a), cursorFor(b)));

  const pageEntries = combined.slice(0, limit);
  const lastEntry = pageEntries.at(-1);

  return {
    entries: pageEntries.map((entry) => {
      const publicEntry: Partial<SortableTimelineEntry> = { ...entry };
      delete publicEntry.source;
      return publicEntry as MatchTimelineEntry;
    }),
    nextCursor: combined.length > limit && lastEntry
      ? encodeTimelineCursor(cursorFor(lastEntry))
      : null,
  };
}
