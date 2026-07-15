import type { StageType } from '@prisma/client';

export interface StandingsStrategy {
  key: string;
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  tiebreakers: readonly string[];
}

const STANDINGS_STRATEGIES: Record<string, StandingsStrategy> = {
  STANDARD: {
    key: 'STANDARD',
    winPoints: 2,
    drawPoints: 1,
    lossPoints: 0,
    tiebreakers: ['goalPercentage'],
  },
  SSN_4_2_0: {
    key: 'SSN_4_2_0',
    winPoints: 4,
    drawPoints: 2,
    lossPoints: 0,
    tiebreakers: ['goalPercentage'],
  },
  WORLD_NETBALL_2_1_0: {
    key: 'WORLD_NETBALL_2_1_0',
    winPoints: 2,
    drawPoints: 1,
    lossPoints: 0,
    tiebreakers: ['goalPercentage'],
  },
};

export function getStandingsStrategy(key: string): StandingsStrategy {
  const strategy = STANDINGS_STRATEGIES[key];
  if (!strategy) {
    throw new Error(`Unsupported standings strategy: ${key}`);
  }
  return strategy;
}

export function pointsForResult(
  strategyKey: string,
  result: 'WIN' | 'DRAW' | 'LOSS'
): number {
  const strategy = getStandingsStrategy(strategyKey);
  if (result === 'WIN') return strategy.winPoints;
  if (result === 'DRAW') return strategy.drawPoints;
  return strategy.lossPoints;
}

export function periodLabel(period: number, regulationPeriodCount = 4): string {
  if (period <= 0) return 'Pre-match';
  if (period <= regulationPeriodCount) return `Q${period}`;
  return `Extra time ${period - regulationPeriodCount}`;
}

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  REGULAR_SEASON: 'Regular season',
  FINALS: 'Finals',
  POOL: 'Pool stage',
  CLASSIFICATION: 'Classification',
  SEMI_FINALS: 'Semi-finals',
  MEDAL_MATCHES: 'Medal matches',
  OTHER: 'Match',
};

export function stageLabel(
  stage: { name?: string | null; type?: StageType | null },
  roundLabel?: string | null
): string {
  return roundLabel ?? stage.name ?? (stage.type ? STAGE_TYPE_LABELS[stage.type] : 'Match');
}
