export const MATCH_TIMELINE_EVENT_TYPES = [
  'goal',
  'intercept',
  'deflection',
  'rebound',
  'turnover',
] as const;

export type MatchTimelineEventType = (typeof MATCH_TIMELINE_EVENT_TYPES)[number];

export interface MatchTimelineEntry {
  id: string;
  period: number;
  periodSeconds: number;
  eventType: MatchTimelineEventType;
  teamId: string;
  homeScore?: number;
  awayScore?: number;
  scorePoints?: number;
  playerId?: string | null;
  playerName?: string | null;
  playerPhotoUrl?: string | null;
}

export interface MatchTimelineResponse {
  entries: MatchTimelineEntry[];
  nextCursor: string | null;
}
