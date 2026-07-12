import type { TeamInfoWithId } from '@/types/team';

export interface PersonalizedMatchCard {
  id: string;
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETED';
  scheduledAt: string;
  homeScore: number;
  awayScore: number;
  venue: string;
  round: number;
  finalCode: string | null;
  currentQuarter: number | null;
  currentTime: string | null;
  homeTeam: TeamInfoWithId;
  awayTeam: TeamInfoWithId;
  homeBreakdown: { goals: number; superShots: number } | null;
  awayBreakdown: { goals: number; superShots: number } | null;
}

export interface MyTeamHubItem {
  team: TeamInfoWithId;
  nextMatch: PersonalizedMatchCard | null;
  latestResult: PersonalizedMatchCard | null;
}
