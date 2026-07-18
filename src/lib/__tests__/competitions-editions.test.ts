import { describe, expect, it } from 'vitest';
import type { CompetitionOption } from '@/lib/competitions';
import { isEditionPubliclyReady, selectEditionBySlugs } from '@/lib/competitions';
import { evaluateEditionPublicationReadiness } from '@/lib/edition-publication';
import { toEditionContext } from '@/lib/edition-context';

function edition(
  id: string,
  competitionSlug: string,
  editionSlug: string,
  publicationStatus: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED',
  counts: { entries: number; matches: number } = { entries: 8, matches: 14 },
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
    matches: [],
    stages: [],
    importRuns: [],
    _count: counts,
  } as CompetitionOption;
}

describe('edition route resolution', () => {
  const editions = [
    edition('ssn', 'suncorp-super-netball', '2026'),
    edition('glasgow', 'commonwealth-games', 'glasgow-2026'),
    edition('draft', 'commonwealth-games', 'test-event', 'DRAFT'),
    edition('empty', 'commonwealth-games', 'empty-event', 'PUBLISHED', { entries: 0, matches: 0 }),
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
    expect(selectEditionBySlugs(editions, {
      competitionSlug: 'commonwealth-games',
      editionSlug: 'empty-event',
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

describe('edition publication readiness', () => {
  it('blocks an empty tournament shell even if its status was set to published', () => {
    expect(evaluateEditionPublicationReadiness({
      publicationStatus: 'PUBLISHED',
      teamCount: 0,
      matchCount: 0,
    })).toEqual({
      ready: false,
      blockers: [
        'requires at least 2 participating teams; found 0',
        'requires at least 1 match; found 0',
      ],
    });
  });

  it('allows an imported draft to pass the data gate before explicit publication', () => {
    expect(evaluateEditionPublicationReadiness({
      publicationStatus: 'DRAFT',
      teamCount: 12,
      matchCount: 38,
    })).toEqual({ ready: true, blockers: [] });
  });

  it('requires archived editions to be deliberately restored first', () => {
    expect(evaluateEditionPublicationReadiness({
      publicationStatus: 'ARCHIVED',
      teamCount: 12,
      matchCount: 38,
    }).ready).toBe(false);
  });

  it('keeps Glasgow out of public selectors unless the complete published import is present', () => {
    const glasgow = {
      ...edition(
        'glasgow-strict',
        'commonwealth-games-netball',
        'glasgow-2026',
        'PUBLISHED',
        { entries: 12, matches: 38 },
      ),
      stages: [
        { slug: 'pool-stage', type: 'POOL', sequence: 1, isPublished: true, _count: { groups: 2, matches: 30 } },
        { slug: 'classification', type: 'CLASSIFICATION', sequence: 2, isPublished: true, _count: { groups: 0, matches: 4 } },
        { slug: 'semi-finals', type: 'SEMI_FINALS', sequence: 3, isPublished: true, _count: { groups: 0, matches: 2 } },
        { slug: 'medal-matches', type: 'MEDAL_MATCHES', sequence: 4, isPublished: true, _count: { groups: 0, matches: 2 } },
      ],
      matches: Array.from({ length: 38 }, () => ({ _count: { slots: 2 } })),
      importRuns: [{ id: 'clean-import' }],
    } as CompetitionOption;

    expect(isEditionPubliclyReady(glasgow)).toBe(true);
    expect(isEditionPubliclyReady({
      ...glasgow,
      matches: [...glasgow.matches.slice(0, -1), { _count: { slots: 1 } }],
    })).toBe(false);
    expect(isEditionPubliclyReady({
      ...glasgow,
      importRuns: [],
    })).toBe(false);
    expect(isEditionPubliclyReady({
      ...glasgow,
      stages: glasgow.stages.map((stage) => stage.slug === 'medal-matches'
        ? { ...stage, isPublished: false }
        : stage),
    })).toBe(false);
  });
});
