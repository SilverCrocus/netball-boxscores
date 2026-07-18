import type { DataCapability } from '@prisma/client';
import type { NormalizedCoverageInput } from '@/lib/sources/types';

export const ALL_DATA_CAPABILITIES: readonly DataCapability[] = [
  'FINAL_SCORE',
  'PERIOD_SCORES',
  'TEAM_BOX_SCORE',
  'PLAYER_BOX_SCORE',
  'SCORE_FLOW',
  'MATCH_EVENTS',
  'SUBSTITUTIONS',
  'NET_POINTS',
  'SUPER_SHOTS',
  'LINEUPS',
];

export function completeCoverageMatrix(
  coverage: readonly NormalizedCoverageInput[]
): NormalizedCoverageInput[] {
  const editionCoverage = new Map(
    coverage
      .filter((item) => !item.matchExternalId)
      .map((item) => [item.capability, item])
  );
  const explicitMatchCoverage = coverage.filter((item) => item.matchExternalId);

  return [
    ...ALL_DATA_CAPABILITIES.map((capability) =>
      editionCoverage.get(capability) ?? {
        capability,
        state: 'UNAVAILABLE' as const,
        notes: 'Not supplied by this source payload',
      }
    ),
    ...explicitMatchCoverage,
  ];
}
