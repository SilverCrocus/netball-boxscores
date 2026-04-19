'use client';

import dynamic from 'next/dynamic';
import type { TeamInfo } from '@/types/team';

const ScoreProgressChart = dynamic(
  () => import('@/components/match/ScoreProgressChart').then((m) => m.ScoreProgressChart),
  { ssr: false },
);

interface MatchMomentumChartProps {
  scoreFlow: { period: number; periodSeconds: number; homeScore: number; awayScore: number }[];
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
}

export function MatchMomentumChart({ scoreFlow, homeTeam, awayTeam }: MatchMomentumChartProps) {
  return (
    <ScoreProgressChart
      scoreFlow={scoreFlow}
      homeTeam={homeTeam}
      awayTeam={awayTeam}
    />
  );
}
