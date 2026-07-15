import type { NormalizedCompetitionImport } from '@/lib/sources/types';

export function validImport(): NormalizedCompetitionImport {
  return {
    context: {
      sourceKey: 'manual',
      editionExternalId: 'test-2026',
      retrievedAt: '2026-07-15T00:00:00.000Z',
    },
    teams: [
      { externalId: 'AUS', name: 'Australia', slug: 'australia', abbreviation: 'AUS' },
      { externalId: 'NZL', name: 'New Zealand', slug: 'new-zealand', abbreviation: 'NZL' },
    ],
    players: [
      { externalId: 'player-1', teamExternalId: 'AUS', name: 'Test Player', position: 'C' },
    ],
    rosters: [
      { teamExternalId: 'AUS', playerExternalId: 'player-1', status: 'ACTIVE' },
    ],
    matches: [
      {
        externalId: 'match-1',
        stageSlug: 'pool-stage',
        scheduledAt: '2026-07-25T08:00:00.000Z',
        venue: 'SEC',
        neutralVenue: true,
        roundLabel: 'Pool A',
        round: 1,
        sideA: { teamExternalId: 'AUS' },
        sideB: { teamExternalId: 'NZL' },
      },
    ],
    results: [
      { matchExternalId: 'match-1', status: 'COMPLETED', sideAScore: 60, sideBScore: 55 },
    ],
    coverage: [
      { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
      { capability: 'PERIOD_SCORES', state: 'UNAVAILABLE' },
    ],
  };
}
