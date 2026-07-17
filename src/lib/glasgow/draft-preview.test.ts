import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GLASGOW_2026_IDENTITY } from '@/lib/edition-publication-readiness';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: { competition: { findFirst } },
}));

import { loadGlasgowDraftPreview } from '@/lib/glasgow/draft-preview';

const teams = Array.from({ length: 12 }, (_, index) => ({
  id: `team-${index + 1}`,
  name: index === 0 ? 'Australia' : `Team ${index + 1}`,
  slug: `team-${index + 1}`,
  abbreviation: index === 0 ? 'AUS' : `T${index + 1}`,
  logoUrl: null,
}));

const entries = teams.map((team, index) => ({
  id: `entry-${index + 1}`,
  seed: index + 1,
  displayName: team.name,
  primaryGroup: { id: index < 6 ? 'pool-a' : 'pool-b', name: index < 6 ? 'Pool A' : 'Pool B' },
  team,
  roster: Array.from({ length: 8 }, (_, playerIndex) => ({
    id: `roster-${index + 1}-${playerIndex + 1}`,
    bib: null,
    designatedPosition: null,
    isCaptain: playerIndex === 0,
    player: {
      id: `player-${index + 1}-${playerIndex + 1}`,
      name: `Player ${index + 1}-${playerIndex + 1}`,
      position: 'C',
      nationality: null,
    },
  })),
}));

const stagePlan = [
  { id: 'pool-stage', slug: 'pool-stage', name: 'Pool Stage', type: 'POOL', sequence: 1, count: 30 },
  { id: 'classification', slug: 'classification', name: 'Classification', type: 'CLASSIFICATION', sequence: 2, count: 4 },
  { id: 'semi-finals', slug: 'semi-finals', name: 'Semi-finals', type: 'SEMI_FINALS', sequence: 3, count: 2 },
  { id: 'medal-matches', slug: 'medal-matches', name: 'Medal Matches', type: 'MEDAL_MATCHES', sequence: 4, count: 2 },
] as const;

const matches = stagePlan.flatMap((stage) => Array.from({ length: stage.count }, (_, index) => ({
  id: `${stage.id}-${index + 1}`,
  scheduledAt: new Date(Date.UTC(2026, 6, 25 + stage.sequence, 8 + (index % 4))),
  status: 'SCHEDULED',
  resultQuality: 'UNKNOWN',
  homeScore: 0,
  awayScore: 0,
  venue: 'The Hydro',
  neutralVenue: true,
  round: null,
  roundLabel: stage.name,
  finalCode: null,
  homeTeam: stage.type === 'POOL' ? teams[index % teams.length] : null,
  awayTeam: stage.type === 'POOL' ? teams[(index + 1) % teams.length] : null,
  stage: {
    id: stage.id,
    slug: stage.slug,
    name: stage.name,
    type: stage.type,
    sequence: stage.sequence,
  },
  stageGroup: stage.type === 'POOL'
    ? { id: index % 2 ? 'pool-b' : 'pool-a', slug: index % 2 ? 'pool-b' : 'pool-a', name: index % 2 ? 'Pool B' : 'Pool A', sequence: index % 2 ? 2 : 1 }
    : null,
  slots: stage.type === 'POOL'
    ? [
        { side: 'A', sourceLabel: null, resolvedEntry: { displayName: teams[index % teams.length].name, team: teams[index % teams.length] } },
        { side: 'B', sourceLabel: null, resolvedEntry: { displayName: teams[(index + 1) % teams.length].name, team: teams[(index + 1) % teams.length] } },
      ]
    : [
        { side: 'A', sourceLabel: 'Qualifier A', resolvedEntry: null },
        { side: 'B', sourceLabel: 'Qualifier B', resolvedEntry: null },
      ],
  dataCoverage: [],
})));

const record = {
  id: 'glasgow-edition-id',
  name: 'Commonwealth Games Netball 2026',
  season: 2026,
  slug: GLASGOW_2026_IDENTITY.editionSlug,
  label: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
  publicationStatus: 'DRAFT',
  series: {
    name: 'Commonwealth Games Netball',
    slug: GLASGOW_2026_IDENTITY.competitionSlug,
    kind: 'TOURNAMENT',
  },
  dataCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE' }],
  entries,
  stages: stagePlan.map((stage) => ({
    id: stage.id,
    slug: stage.slug,
    name: stage.name,
    type: stage.type,
    sequence: stage.sequence,
    isPublished: false,
    groups: stage.type === 'POOL' ? [
      { id: 'pool-a', slug: 'pool-a', name: 'Pool A', sequence: 1, primaryEntries: entries.slice(0, 6).map((entry) => ({ id: entry.id, seed: entry.seed, displayName: entry.displayName, team: entry.team })) },
      { id: 'pool-b', slug: 'pool-b', name: 'Pool B', sequence: 2, primaryEntries: entries.slice(6).map((entry) => ({ id: entry.id, seed: entry.seed, displayName: entry.displayName, team: entry.team })) },
    ] : [],
  })),
  matches,
};

describe('loadGlasgowDraftPreview', () => {
  beforeEach(() => findFirst.mockReset().mockResolvedValue(record));

  it('uses one exact, read-only DRAFT query and includes all private edition structures', async () => {
    const preview = await loadGlasgowDraftPreview();

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        publicationStatus: 'DRAFT',
        slug: GLASGOW_2026_IDENTITY.editionSlug,
        series: { is: { slug: GLASGOW_2026_IDENTITY.competitionSlug } },
      },
    }));
    const query = findFirst.mock.calls[0][0];
    expect(query.select.matches.where).toEqual({ isSimulation: false });
    expect(query.select.stages.select.isPublished).toBe(true);
    expect(query.select.stages.where).toBeUndefined();
    expect(query.select.entries.where).toEqual({ status: 'ACTIVE' });
    expect(query.select.entries.select.roster.where).toEqual({ status: 'ACTIVE' });

    expect(preview?.edition).toMatchObject({ publicationStatus: 'DRAFT', unpublishedStageCount: 4 });
    expect(preview?.schedule.summary).toMatchObject({ fixtureCount: 38, teamCount: 12, stageCount: 4 });
    expect(preview?.schedule.stages.flatMap((stage) => stage.dates.flatMap((date) => date.fixtures))).toHaveLength(38);
    expect(preview?.pools?.pools).toHaveLength(2);
    expect(preview?.bracket.flatMap((stage) => stage.matches)).toHaveLength(8);
    expect(preview?.rosters).toHaveLength(12);
    expect(preview?.activeRosterCount).toBe(96);
  });

  it('hides scheduled default zero scores and returns null if the exact DRAFT edition is absent', async () => {
    const preview = await loadGlasgowDraftPreview();
    const fixtures = preview?.schedule.stages.flatMap((stage) =>
      stage.dates.flatMap((date) => date.fixtures));
    expect(fixtures?.every((fixture) => fixture.score === null)).toBe(true);

    findFirst.mockResolvedValueOnce(null);
    await expect(loadGlasgowDraftPreview()).resolves.toBeNull();
  });
});
