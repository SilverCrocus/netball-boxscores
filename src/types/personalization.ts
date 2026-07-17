import type { TeamInfoWithId } from '@/types/team';
import type { MatchStatus } from '@prisma/client';

export interface PersonalizedMatchCard {
  id: string;
  competitionId: string;
  status: MatchStatus;
  scoreAvailable: boolean;
  scheduledAt: string;
  homeScore: number;
  awayScore: number;
  venue: string;
  round: number | null;
  roundLabel: string | null;
  stageName: string | null;
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
