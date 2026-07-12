import type { Position } from '@prisma/client';
import { computeShootingPct } from '@/lib/stat-utils';

interface MvpStatSource {
  position: Position;
  goals: number;
  attempts: number;
  goalAssists: number;
  feeds: number;
  gain: number;
  intercepts: number;
  deflections: number;
}

export interface MvpSupportingStat {
  label: string;
  value: number | string;
}

const DEFENSIVE_POSITIONS = new Set<Position>(['WD', 'GD', 'GK']);
const SHOOTING_POSITIONS = new Set<Position>(['GS', 'GA']);

export function getMvpSupportingStats(stats: MvpStatSource): [MvpSupportingStat, MvpSupportingStat] {
  if (DEFENSIVE_POSITIONS.has(stats.position)) {
    const turnoverStat = stats.deflections >= stats.intercepts
      ? { label: 'Deflections', value: stats.deflections }
      : { label: 'Intercepts', value: stats.intercepts };

    return [
      { label: 'Gains', value: stats.gain },
      turnoverStat,
    ];
  }

  if (SHOOTING_POSITIONS.has(stats.position)) {
    return [
      { label: 'Goals', value: stats.goals },
      { label: 'Goal %', value: `${Math.round(computeShootingPct(stats.goals, stats.attempts))}%` },
    ];
  }

  return [
    { label: 'Goal Ast', value: stats.goalAssists },
    { label: 'Feeds', value: stats.feeds },
  ];
}
