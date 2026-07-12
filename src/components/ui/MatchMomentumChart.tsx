'use client';

import dynamic from 'next/dynamic';
import type { TeamInfo } from '@/types/team';

const ScoreProgressChart = dynamic(
  () => import('@/components/match/ScoreProgressChart').then((m) => m.ScoreProgressChart),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-[132px] items-center justify-center rounded-xl bg-surface-container-lowest text-xs text-on-surface-variant"
      >
        Loading score chart…
      </div>
    ),
  },
);

interface MatchMomentumChartProps {
  scoreFlow: { period: number; periodSeconds: number; homeScore: number; awayScore: number }[];
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
}

export function MatchMomentumChart({ scoreFlow, homeTeam, awayTeam }: MatchMomentumChartProps) {
  const quarterSummaries = Array.from(
    scoreFlow.reduce((summaries, point) => summaries.set(point.period, point), new Map<number, typeof scoreFlow[number]>()),
  ).map(([quarter, point]) => ({ quarter, homeScore: point.homeScore, awayScore: point.awayScore }));

  return (
    <>
      <div aria-hidden="true" className="min-h-[132px]">
        <ScoreProgressChart
          scoreFlow={scoreFlow}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
        />
      </div>
      <div className="sr-only">
        <table>
          <caption>Score progression by quarter</caption>
          <thead>
            <tr>
              <th>Quarter</th>
              <th>{homeTeam.name}</th>
              <th>{awayTeam.name}</th>
            </tr>
          </thead>
          <tbody>
            {quarterSummaries.map((summary) => (
              <tr key={summary.quarter}>
                <th>Quarter {summary.quarter}</th>
                <td>{summary.homeScore}</td>
                <td>{summary.awayScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
