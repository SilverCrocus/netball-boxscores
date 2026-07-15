import type { CoverageState, DataCapability, ResultQualityStatus } from '@prisma/client';

export interface CoverageRecord {
  capability: DataCapability;
  state: CoverageState;
}

export interface CapabilityResolution {
  capability: DataCapability;
  state: CoverageState;
  scope: 'match' | 'edition' | 'missing';
  available: boolean;
}

export function resolveCapability(
  capability: DataCapability,
  editionCoverage: readonly CoverageRecord[],
  matchCoverage: readonly CoverageRecord[] = []
): CapabilityResolution {
  const match = matchCoverage.find((item) => item.capability === capability);
  const edition = editionCoverage.find((item) => item.capability === capability);
  const resolved = match ?? edition;

  if (!resolved) {
    return { capability, state: 'UNAVAILABLE', scope: 'missing', available: false };
  }

  return {
    capability,
    state: resolved.state,
    scope: match ? 'match' : 'edition',
    available: resolved.state !== 'UNAVAILABLE',
  };
}

export interface EditionFeatureFlags {
  playerBoxScore: CapabilityResolution;
  netPoints: CapabilityResolution;
  matchEvents: CapabilityResolution;
  scoreFlow: CapabilityResolution;
  superShots: CapabilityResolution;
}

export function resolveEditionFeatures(
  editionCoverage: readonly CoverageRecord[],
  matchCoverage: readonly CoverageRecord[] = []
): EditionFeatureFlags {
  return {
    playerBoxScore: resolveCapability('PLAYER_BOX_SCORE', editionCoverage, matchCoverage),
    netPoints: resolveCapability('NET_POINTS', editionCoverage, matchCoverage),
    matchEvents: resolveCapability('MATCH_EVENTS', editionCoverage, matchCoverage),
    scoreFlow: resolveCapability('SCORE_FLOW', editionCoverage, matchCoverage),
    superShots: resolveCapability('SUPER_SHOTS', editionCoverage, matchCoverage),
  };
}

export type FixtureLifecycleStatus =
  | 'SCHEDULED'
  | 'LIVE'
  | 'COMPLETED'
  | 'DELAYED'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'ABANDONED';

const FINAL_QUALITY = new Set<ResultQualityStatus>([
  'UNOFFICIAL_FINAL',
  'OFFICIAL_FINAL',
  'CORRECTED',
]);

export function isFinalFixture(
  status: FixtureLifecycleStatus,
  resultQuality: ResultQualityStatus
): boolean {
  return status === 'COMPLETED' && FINAL_QUALITY.has(resultQuality);
}
