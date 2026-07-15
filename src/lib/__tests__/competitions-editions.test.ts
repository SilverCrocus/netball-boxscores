import { describe, expect, it } from 'vitest';
import type { CompetitionOption } from '@/lib/competitions';
import { selectEditionBySlugs } from '@/lib/competitions';
import { toEditionContext } from '@/lib/edition-context';

function edition(
  id: string,
  competitionSlug: string,
  editionSlug: string,
  publicationStatus: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED'
): CompetitionOption {
  return {
    id,
    season: 2026,
    name: `${competitionSlug} 2026`,
    slug: editionSlug,
    label: '2026',
    seasonStart: null,
    seasonEnd: null,
    sourceTimezone: competitionSlug === 'commonwealth-games' ? 'Europe/London' : 'Australia/Sydney',
    publicationStatus,
    series: {
      id: `${id}-series`,
      slug: competitionSlug,
      name: competitionSlug === 'commonwealth-games' ? 'Commonwealth Games' : 'Suncorp Super Netball',
      kind: competitionSlug === 'commonwealth-games' ? 'TOURNAMENT' : 'LEAGUE',
    },
    ruleset: null,
    dataCoverage: [],
  } as CompetitionOption;
}

describe('edition route resolution', () => {
  const editions = [
    edition('ssn', 'suncorp-super-netball', '2026'),
    edition('glasgow', 'commonwealth-games', 'glasgow-2026'),
    edition('draft', 'commonwealth-games', 'test-event', 'DRAFT'),
  ];

  it('resolves two editions in the same year by exact route slugs', () => {
    expect(selectEditionBySlugs(editions, {
      competitionSlug: 'suncorp-super-netball',
      editionSlug: '2026',
    })?.id).toBe('ssn');
    expect(selectEditionBySlugs(editions, {
      competitionSlug: 'commonwealth-games',
      editionSlug: 'glasgow-2026',
    })?.id).toBe('glasgow');
  });

  it('does not fall back for an unknown or unpublished slug', () => {
    expect(selectEditionBySlugs(editions, {
      competitionSlug: 'commonwealth-games',
      editionSlug: 'typo-2026',
    })).toBeNull();
    expect(selectEditionBySlugs(editions, {
      competitionSlug: 'commonwealth-games',
      editionSlug: 'test-event',
    })).toBeNull();
  });

  it('creates a serializable context with the edition timezone', () => {
    expect(toEditionContext(editions[1])).toMatchObject({
      competitionSlug: 'commonwealth-games',
      editionSlug: 'glasgow-2026',
      sourceTimezone: 'Europe/London',
    });
  });
});
