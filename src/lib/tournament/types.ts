export interface TournamentTeam {
  entryId: string;
  teamId: string;
  name: string;
  displayName: string;
  slug: string;
  abbreviation: string;
  logoUrl: string | null;
  seed: number | null;
}
export interface TournamentPool {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  teams: TournamentTeam[];
}

export interface TournamentPoolOverview {
  stageId: string;
  stageName: string;
  participantCount: number;
  pools: TournamentPool[];
}

export interface TournamentStanding {
  id: string;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  goalPercentage: number;
  points: number;
}

export interface TournamentStandingRow extends TournamentTeam {
  standing: TournamentStanding | null;
}

export interface TournamentPoolStandings {
  id: string;
  slug: string;
  name: string;
  sequence: number;
  hasStandings: boolean;
  rows: TournamentStandingRow[];
}

export interface TournamentStandingsOverview {
  stageId: string;
  stageName: string;
  hasAnyStandings: boolean;
  pools: TournamentPoolStandings[];
}

export interface TournamentBracketTeam {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

export interface TournamentBracketSide {
  side: 'A' | 'B';
  label: string;
  resolved: boolean;
  team: TournamentBracketTeam | null;
  score: number | null;
}

export interface TournamentBracketMatch {
  id: string;
  label: string;
  scheduledAt: string;
  venue: string;
  status: string;
  sideA: TournamentBracketSide;
  sideB: TournamentBracketSide;
}

export interface TournamentBracketStage {
  id: string;
  slug: string;
  name: string;
  type: 'CLASSIFICATION' | 'SEMI_FINALS' | 'MEDAL_MATCHES';
  sequence: number;
  matches: TournamentBracketMatch[];
}
