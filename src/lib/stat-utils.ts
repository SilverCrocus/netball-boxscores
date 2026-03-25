import type { PlayerMatchStats } from '@prisma/client';

type StatRecord = Record<string, number>;

/**
 * Get a numeric stat value from a PlayerMatchStats record by field name.
 * Handles the computed 'shootingPct' field and dynamic field access.
 */
export function getStatValue(stat: PlayerMatchStats, field: string): number {
  if (field === 'shootingPct') {
    return stat.attempts > 0 ? (stat.goals / stat.attempts) * 100 : 0;
  }
  return (stat as unknown as StatRecord)[field] ?? 0;
}
