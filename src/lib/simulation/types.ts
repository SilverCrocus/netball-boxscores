export type SimMatchState =
  | 'pre-match'
  | 'q1-active'
  | 'q1-break'
  | 'q2-active'
  | 'q2-break'
  | 'q3-active'
  | 'q3-break'
  | 'q4-active'
  | 'match-complete';

export interface SimPlayer {
  championDataPlayerId: number;
  name: string;
  position: string; // GS, GA, WA, C, WD, GD, GK
  squadId: number;
}

export interface SimScoreFlowEntry {
  period: number;
  periodSeconds: number;
  squadId: number;
  scorepoints: number;
  homeScore: number;
  awayScore: number;
}

export interface SimPlayerStats {
  playerId: number; // championDataPlayerId
  displayName: string;
  position: string;
  squadId: number;
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
}

export interface SimMatch {
  matchIndex: number;
  championDataMatchId: number; // fake ID: 99001, 99002, ...
  prismaMatchId: string; // created Match record ID
  state: SimMatchState;
  homeSquadId: number;
  homeSquadName: string;
  homeSquadCode: string;
  awaySquadId: number;
  awaySquadName: string;
  awaySquadCode: string;
  homeScore: number;
  awayScore: number;
  period: number;
  periodSeconds: number;
  tickCount: number;
  scoreFlow: SimScoreFlowEntry[];
  playerStats: SimPlayerStats[];
  homePlayers: SimPlayer[];
  awayPlayers: SimPlayer[];
  venue: string;
  startOffset: number; // ticks to delay before starting
}

export interface SimConfig {
  matchCount: number;
  speed: number; // multiplier: 1, 2, 5, 10, 50
  tickStep: number; // game-seconds per tick (default 30)
}

export interface SimState {
  running: boolean;
  paused: boolean;
  config: SimConfig;
  matches: SimMatch[];
  log: SimLogEntry[];
}

export interface SimLogEntry {
  timestamp: number;
  matchIndex: number;
  message: string;
}

/** State transition map */
export const STATE_ORDER: SimMatchState[] = [
  'pre-match',
  'q1-active',
  'q1-break',
  'q2-active',
  'q2-break',
  'q3-active',
  'q3-break',
  'q4-active',
  'match-complete',
];

/** Map state to Champion Data matchStatus */
export function stateToMatchStatus(state: SimMatchState): string {
  if (state === 'pre-match') return 'scheduled';
  if (state === 'match-complete') return 'complete';
  return 'playing';
}

/** Map state to period number */
export function stateToPeriod(state: SimMatchState): number {
  const map: Record<SimMatchState, number> = {
    'pre-match': 0,
    'q1-active': 1, 'q1-break': 1,
    'q2-active': 2, 'q2-break': 2,
    'q3-active': 3, 'q3-break': 3,
    'q4-active': 4,
    'match-complete': 4,
  };
  return map[state];
}

/** Is this an active (scoring) state? */
export function isActiveState(state: SimMatchState): boolean {
  return state.endsWith('-active');
}

/** Is this a break state? */
export function isBreakState(state: SimMatchState): boolean {
  return state.endsWith('-break');
}
