// ───── Competitions endpoint response ─────
// GET mc.championdata.com/data/competitions.json

export interface CDCompetitionsResponse {
  competitions: CDCompetition[];
}

export interface CDCompetition {
  id: number;
  name: string;
  season: number;
  sport: string;
}

// ───── Fixture endpoint response ─────
// GET mc.championdata.com/data/{compId}/fixture.json

export interface CDFixtureResponse {
  fixture: {
    jobId: number;
    match: CDFixtureMatch[];
  };
}

export interface CDFixtureMatch {
  matchId: number;
  matchNumber: number;
  matchType: string;
  roundNumber: number;
  homeSquadId: number;
  homeSquadName: string;
  homeSquadCode: string;
  homeSquadShortCode: string;
  homeSquadNickname: string;
  homeSquadScore: number;
  awaySquadId: number;
  awaySquadName: string;
  awaySquadCode: string;
  awaySquadShortCode: string;
  awaySquadNickname: string;
  awaySquadScore: number;
  venue: string; // deprecated alias
  venueName: string;
  venueId: number;
  venueCode: string;
  localStartTime: string; // ISO 8601
  utcStartTime: string;
  matchStatus: string; // "scheduled" | "playing" | "complete"
  period: number;
  periodSecs: number;
  periodCompleted: number;
  isNetball2pt: boolean;
  finalCode: string;
  finalShortCode: string;
}

// ───── Match Stats endpoint response ─────
// GET mc.championdata.com/data/{compId}/{matchId}.json

export interface CDMatchStatsResponse {
  matchInfo: CDMatchInfo;
  scoreFlow: CDScoreFlowEntry[];
  teamStats: {
    home: CDTeamStats;
    away: CDTeamStats;
  };
  playerStats: {
    home: CDPlayerStats[];
    away: CDPlayerStats[];
  };
  periodScores: CDPeriodScore[];
}

export interface CDMatchInfo {
  matchId: number;
  round: number;
  venue: string;
  homeSquadId: number;
  homeSquadName: string;
  awaySquadId: number;
  awaySquadName: string;
  homeScore: number;
  awayScore: number;
  matchStatus: string;
  period: number;
  periodSeconds: number;
}

export interface CDScoreFlowEntry {
  period: number;
  periodSeconds: number;
  squadId: number;
  scorepoints: number;
  homeScore: number;
  awayScore: number;
}

export interface CDTeamStats {
  squadId: number;
  goals: number;
  attempts: number;
  goal2: number;
  attempt2: number;
  points: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  contactPenalties: number;
  obstructionPenalties: number;
  feeds: number;
  feedWithAttempt: number;
  centrePassReceives: number;
  turnovers: number;
  gain: number;
  timeout: number;
  timeInPossession: number;
  timeToScore: number;
  goalsFromCentrePass: number;
  goalsFromGain: number;
  centrePassToGoalPerc: number;
  gainToGoalPerc: number;
  possessionChanges: number;
  netPoints: number;
  goalMisses: number;
  blocks: number;
  pickups: number;
  tossUpWin: number;
}

export interface CDPlayerStats {
  playerId: number;
  displayName: string;
  position: string; // "GS", "GA", etc.
  squadId: number;
  goals: number;
  attempts: number;
  goal2: number;
  attempt2: number;
  netPoints: number;
  points: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  contactPenalties: number;
  obstructionPenalties: number;
  feeds: number;
  feedWithAttempt: number;
  centrePassReceives: number;
  turnovers: number;
  minutesPlayed: number;
  goalMisses: number;
  gain: number;
  pickups: number;
  centrePassToGoalPerc: number;
  quartersPlayed: number;
  blocks: number;
  tossUpWin: number;
  secondPhaseReceive: number;
  possessionChanges: number;
  unforcedTurnovers: number;
  interceptPassThrown: number;
}

export interface CDPeriodScore {
  period: number;
  homeScore: number;
  awayScore: number;
}

// ───── Raw Champion Data match stats response ─────
// The real CD API wraps match stats in { matchStats: { ... } } with
// different field names than our normalised CDMatchStatsResponse.

export interface CDRawMatchStatsResponse {
  matchStats: {
    matchInfo: CDRawMatchInfo;
    teamStats?: { team?: CDRawTeamStats[] };
    playerStats?: { player?: CDRawPlayerStats[] };
    scoreFlow?: { score?: CDRawScoreFlowEntry[] };
  };
}

export interface CDRawMatchInfo {
  matchId?: number;
  roundNumber?: number;
  venueName?: string;
  homeSquadId: number;
  awaySquadId: number;
  matchStatus?: string;
  period?: number;
  periodSeconds?: number;
}

export interface CDRawTeamStats {
  squadId: number;
  points?: number;
  goals?: number;
  goalAttempts?: number;
  goal2?: number;
  attempt2?: number;
  goalAssists?: number;
  intercepts?: number;
  deflections?: number;
  rebounds?: number;
  penalties?: number;
  contactPenalties?: number;
  obstructionPenalties?: number;
  feeds?: number;
  feedWithAttempt?: number;
  centrePassReceives?: number;
  generalPlayTurnovers?: number;
  gain?: number;
  timeout?: number;
  timeInPossession?: number;
  timeToScore?: number;
  goalsFromCentrePass?: number;
  goalsFromGain?: number;
  centrePassToGoalPerc?: number;
  gainToGoalPerc?: number;
  possessionChanges?: number;
  netPoints?: number;
  goalMisses?: number;
  blocks?: number;
  pickups?: number;
  tossUpWin?: number;
}

export interface CDRawPlayerStats {
  playerId: number;
  displayName?: string;
  currentPositionCode?: string;
  startingPositionCode?: string;
  squadId: number;
  goals?: number;
  goalAttempts?: number;
  goal2?: number;
  attempt2?: number;
  netPoints?: number;
  points?: number;
  goalAssists?: number;
  intercepts?: number;
  deflections?: number;
  rebounds?: number;
  penalties?: number;
  contactPenalties?: number;
  obstructionPenalties?: number;
  feeds?: number;
  feedWithAttempt?: number;
  centrePassReceives?: number;
  generalPlayTurnovers?: number;
  minutesPlayed?: number;
  goalMisses?: number;
  gain?: number;
  pickups?: number;
  centrePassToGoalPerc?: number;
  quartersPlayed?: number;
  blocks?: number;
  tossUpWin?: number;
  secondPhaseReceive?: number;
  possessionChanges?: number;
  unforcedTurnovers?: number;
  interceptPassThrown?: number;
}

export interface CDRawScoreFlowEntry {
  period: number;
  periodSeconds: number;
  squadId: number;
  scorepoints: number;
}
