import type { PlayerMatchStats } from '@prisma/client';

type StatRecord = Record<string, number>;

export const STAT_FIELDS = [
  'goals',
  'attempts',
  'goalAssists',
  'intercepts',
  'deflections',
  'rebounds',
  'penalties',
  'feeds',
  'centrePassReceives',
  'turnovers',
  'minutesPlayed',
] as const;

export type StatFieldName = (typeof STAT_FIELDS)[number];

export type StatValues = Record<StatFieldName, number>;

export function emptyStats(): StatValues {
  return Object.fromEntries(STAT_FIELDS.map((f) => [f, 0])) as StatValues;
}

export function pickStatFields(obj: Record<string, unknown> | object): StatValues {
  const rec = obj as StatRecord;
  return Object.fromEntries(
    STAT_FIELDS.map((f) => [f, rec[f] ?? 0]),
  ) as StatValues;
}

export function aggregateStats(items: StatValues[]): Omit<StatValues, 'minutesPlayed'> {
  const result = emptyStats();
  for (const item of items) {
    for (const f of STAT_FIELDS) {
      if (f === 'minutesPlayed') continue;
      result[f] += item[f];
    }
  }
  return result;
}

export function computeShootingPct(goals: number, attempts: number): number {
  return attempts > 0 ? (goals / attempts) * 100 : 0;
}

/**
 * Get a numeric stat value from a PlayerMatchStats record by field name.
 * Handles the computed 'shootingPct' field and dynamic field access.
 */
export function getStatValue(stat: PlayerMatchStats, field: string): number {
  if (field === 'shootingPct') {
    return computeShootingPct(stat.goals, stat.attempts);
  }
  return (stat as unknown as StatRecord)[field] ?? 0;
}
