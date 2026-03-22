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
  fixture: CDFixtureMatch[];
}

export interface CDFixtureMatch {
  matchId: number;
  round: number;
  roundName: string;
  homeSquadId: number;
  homeSquadName: string;
  awaySquadId: number;
  awaySquadName: string;
  venue: string;
  localStartTime: string; // ISO 8601
  utcStartTime: string;
  homeScore?: number;
  awayScore?: number;
  matchStatus: string; // "Scheduled" | "Playing" | "Complete"
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
