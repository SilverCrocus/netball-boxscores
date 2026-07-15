import { describe, expect, it } from 'vitest';
import { GLASGOW_2026_FOUNDATION } from '@/lib/glasgow/edition';

describe('Glasgow 2026 foundation', () => {
  it('uses a tournament edition with venue-local time and standard scoring', () => {
    expect(GLASGOW_2026_FOUNDATION.series.kind).toBe('TOURNAMENT');
    expect(GLASGOW_2026_FOUNDATION.edition.sourceTimezone).toBe('Europe/London');
    expect(GLASGOW_2026_FOUNDATION.ruleset).toMatchObject({
      periodCount: 4,
      regulationPeriodMinutes: 15,
      scoringModel: 'STANDARD',
      superShotsEnabled: false,
    });
  });

  it('defines pools and unresolved-fixture stages without publishing them', () => {
    expect(GLASGOW_2026_FOUNDATION.groups.map((group) => group.slug)).toEqual(['pool-a', 'pool-b']);
    expect(GLASGOW_2026_FOUNDATION.stages.map((stage) => stage.type)).toEqual([
      'POOL',
      'CLASSIFICATION',
      'SEMI_FINALS',
      'MEDAL_MATCHES',
    ]);
  });

  it('records the approved public-data and sourced-photo policies', () => {
    expect(GLASGOW_2026_FOUNDATION.source.key).toBe('glasgow-2026-public-data');
  });
});
