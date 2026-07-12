import { NextResponse } from 'next/server';
import { loadMatchTimeline, MATCH_TIMELINE_PAGE_SIZE } from '@/lib/match-timeline';
import { MATCH_TIMELINE_EVENT_TYPES, type MatchTimelineEventType } from '@/types/match-timeline';
import { timedQuery } from '@/lib/server-timing';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ matchId: string }>;
}

function badRequest(code: string, message: string) {
  return NextResponse.json({ error: { code, message, retryable: false } }, { status: 400 });
}

export async function GET(request: Request, { params }: RouteContext) {
  const { matchId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const cursor = searchParams.get('cursor') ?? undefined;
  const eventTypeValue = searchParams.get('type') ?? undefined;
  const quarterValue = searchParams.get('quarter');
  const limitValue = searchParams.get('limit');
  const teamId = searchParams.get('team') ?? undefined;
  const quarter = quarterValue === null ? undefined : Number(quarterValue);
  const limit = limitValue === null ? MATCH_TIMELINE_PAGE_SIZE : Number(limitValue);

  if (quarter !== undefined && (!Number.isInteger(quarter) || quarter < 1 || quarter > 8)) {
    return badRequest('INVALID_QUARTER', 'Quarter must be a whole number from 1 to 8.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MATCH_TIMELINE_PAGE_SIZE) {
    return badRequest('INVALID_LIMIT', `Limit must be between 1 and ${MATCH_TIMELINE_PAGE_SIZE}.`);
  }
  if (eventTypeValue && !MATCH_TIMELINE_EVENT_TYPES.includes(eventTypeValue as MatchTimelineEventType)) {
    return badRequest('INVALID_EVENT_TYPE', 'The event type is not supported.');
  }

  try {
    const result = await timedQuery('match_timeline', () => loadMatchTimeline(matchId, {
      cursor,
      eventType: eventTypeValue as MatchTimelineEventType | undefined,
      limit,
      quarter,
      teamId,
    }));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CURSOR') {
      return badRequest('INVALID_CURSOR', 'The timeline cursor is invalid.');
    }
    if (error instanceof Error && error.message === 'MATCH_NOT_FOUND') {
      return NextResponse.json(
        { error: { code: 'MATCH_NOT_FOUND', message: 'The match could not be found.', retryable: false } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: { code: 'TIMELINE_UNAVAILABLE', message: 'Play by play is temporarily unavailable.', retryable: true } },
      { status: 503 },
    );
  }
}
