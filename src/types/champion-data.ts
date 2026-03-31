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
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centrePassReceives: number;
  turnovers: number;
}

export interface CDPlayerStats {
  playerId: number;
  displayName: string;
  position: string; // "GS", "GA", etc.
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
  goalAssists?: number;
  intercepts?: number;
  deflections?: number;
  rebounds?: number;
  penalties?: number;
  feeds?: number;
  centrePassReceives?: number;
  generalPlayTurnovers?: number;
}

export interface CDRawPlayerStats {
  playerId: number;
  displayName?: string;
  currentPositionCode?: string;
  startingPositionCode?: string;
  squadId: number;
  goals?: number;
  goalAttempts?: number;
  goalAssists?: number;
  intercepts?: number;
  deflections?: number;
  rebounds?: number;
  penalties?: number;
  feeds?: number;
  centrePassReceives?: number;
  generalPlayTurnovers?: number;
  minutesPlayed?: number;
}

export interface CDRawScoreFlowEntry {
  period: number;
  periodSeconds: number;
  squadId: number;
  scorepoints: number;
}
