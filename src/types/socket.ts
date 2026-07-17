// ───── Socket.io event types ─────

export interface ScoreUpdatePayload {
  matchId: string;
  revision?: string;
  homeScore: number;
  awayScore: number;
  currentQuarter: number;
  currentTime: string;
}

export interface StatsUpdatePayload {
  matchId: string;
  revision?: string;
  playerStats: Array<{
    playerId: string;
    currentPosition?: string;
    goals: number;
    attempts: number;
    goalAssists: number;
    intercepts: number;
    deflections: number;
    rebounds: number;
    penalties: number;
    feeds: number;
    centrePassReceives: number;
    turnovers: number;
    minutesPlayed: number;
  }>;
}

export interface MatchStatusPayload {
  matchId: string;
  revision?: string;
  status: 'LIVE' | 'COMPLETED';
  quarter: number;
  time: string;
}

export interface ScoreFlowAddPayload {
  matchId: string;
  revision?: string;
  period: number;
  periodSeconds: number;
  scoringTeamId: string;
  homeScore: number;
  awayScore: number;
  scorePoints: number;
  scorerPlayerId?: string;
  scorerName?: string;
}

export interface ScoreFlowSnapshotPayload {
  matchId: string;
  revision?: string;
  entries: ScoreFlowAddPayload[];
}

export interface StatEventPayload {
  eventId: string;
  matchId: string;
  revision?: string;
  type: 'intercept' | 'deflection' | 'rebound' | 'turnover';
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  teamAbbreviation: string;
  teamLogoUrl?: string | null;
  isHomeTeam: boolean;
  quarter: number;
  time: string;
}

export interface StatEventsSnapshotPayload {
  matchId: string;
  revision?: string;
  events: StatEventPayload[];
}

// Server emits these events to clients
export interface ServerToClientEvents {
  'score:update': (payload: ScoreUpdatePayload) => void;
  'stats:update': (payload: StatsUpdatePayload) => void;
  'match:status': (payload: MatchStatusPayload) => void;
  'scoreflow:add': (payload: ScoreFlowAddPayload) => void;
  'scoreflow:snapshot': (payload: ScoreFlowSnapshotPayload) => void;
  'stat:event': (payload: StatEventPayload) => void;
  'stat:snapshot': (payload: StatEventsSnapshotPayload) => void;
}

// Clients emit these events to server
export interface ClientToServerEvents {
  'match:subscribe': (data: { matchId: string }) => void;
  'match:unsubscribe': (data: { matchId: string }) => void;
}
