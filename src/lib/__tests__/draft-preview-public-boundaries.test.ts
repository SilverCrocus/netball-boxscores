import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompetitionOption } from '@/lib/competitions';
import { GLASGOW_2026_IDENTITY } from '@/lib/edition-publication-readiness';

const mocks = vi.hoisted(() => ({
  competitionFindMany: vi.fn(),
  matchFindMany: vi.fn(),
  matchFindUnique: vi.fn(),
  playerFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  completedMatchesPage: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: { isSimulation: false },
  prisma: {
    competition: { findMany: mocks.competitionFindMany },
    match: {
      findMany: mocks.matchFindMany,
      findUnique: mocks.matchFindUnique,
    },
    player: { findMany: mocks.playerFindMany },
    team: { findMany: mocks.teamFindMany },
  },
}));
vi.mock('@/lib/home-feed', () => ({
  getCompletedMatchesPage: mocks.completedMatchesPage,
}));

import { GET as getMatches } from '@/app/api/matches/route';
import { GET as getTeams } from '@/app/api/teams/route';
import sitemap from '@/app/sitemap';
import {
  getPublicCompetitions,
  isEditionPubliclyReady,
  resolveCompetitionById,
  resolveEdition,
} from '@/lib/competitions';
import { toEditionContexts } from '@/lib/edition-context';
import {
  evaluateEditionPublicationReadiness,
  evaluateGlasgowPublishedVisibility,
} from '@/lib/edition-publication-readiness';
import { getVisibleNavigationItems } from '@/lib/navigation';
import { resolvePublicMatchAccess } from '@/lib/public-match';

const draftStages = [
  { slug: 'pool-stage', type: 'POOL', sequence: 1, isPublished: false, _count: { groups: 2, matches: 30 } },
  { slug: 'classification', type: 'CLASSIFICATION', sequence: 2, isPublished: false, _count: { groups: 0, matches: 4 } },
  { slug: 'semi-finals', type: 'SEMI_FINALS', sequence: 3, isPublished: false, _count: { groups: 0, matches: 2 } },
  { slug: 'medal-matches', type: 'MEDAL_MATCHES', sequence: 4, isPublished: false, _count: { groups: 0, matches: 2 } },
] as const;

const draftGlasgow = {
  id: 'glasgow-draft-id',
  season: 2026,
  name: 'Commonwealth Games Netball 2026',
  slug: GLASGOW_2026_IDENTITY.editionSlug,
  label: 'Glasgow 2026',
  seasonStart: new Date('2026-07-25T00:00:00Z'),
  seasonEnd: new Date('2026-08-02T00:00:00Z'),
  sourceTimezone: 'Europe/London',
  publicationStatus: 'DRAFT',
  series: {
    id: 'commonwealth-games-netball',
    slug: GLASGOW_2026_IDENTITY.competitionSlug,
    name: 'Commonwealth Games Netball',
    kind: 'TOURNAMENT',
  },
  ruleset: null,
  dataCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE', observedAt: new Date() }],
  _count: { entries: 12, matches: 38 },
  stages: draftStages,
  matches: Array.from({ length: 38 }, () => ({ _count: { slots: 2 } })),
  importRuns: [{ id: 'clean-import' }],
} as unknown as CompetitionOption;

const publicEdition = {
  id: 'ssn-public-id',
  season: 2026,
  name: 'Suncorp Super Netball 2026',
  slug: '2026',
  label: '2026',
  seasonStart: new Date('2026-03-01T00:00:00Z'),
  seasonEnd: new Date('2026-07-31T00:00:00Z'),
  sourceTimezone: 'Australia/Sydney',
  publicationStatus: 'PUBLISHED',
  series: {
    id: 'ssn',
    slug: 'suncorp-super-netball',
    name: 'Suncorp Super Netball',
    kind: 'LEAGUE',
  },
  ruleset: null,
  dataCoverage: [],
  _count: { entries: 8, matches: 64 },
  stages: [],
  matches: [],
  importRuns: [],
} as unknown as CompetitionOption;

describe('DRAFT Glasgow public regression boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.competitionFindMany.mockResolvedValue([draftGlasgow, publicEdition]);
    mocks.teamFindMany.mockResolvedValue([{
      id: 'public-team-id',
      name: 'Public Team',
      slug: 'public-team',
      abbreviation: 'PUB',
      logoUrl: null,
    }]);
    mocks.matchFindMany.mockResolvedValue([{
      id: 'public-match-id',
      competitionId: publicEdition.id,
      scheduledAt: new Date('2026-07-01T09:00:00Z'),
    }]);
    mocks.playerFindMany.mockResolvedValue([{ id: 'public-player-id' }]);
    mocks.completedMatchesPage.mockResolvedValue({ groups: [], nextCursor: null });
    mocks.matchFindUnique.mockResolvedValue({
      id: 'glasgow-draft-match',
      competitionId: draftGlasgow.id,
      status: 'SCHEDULED',
      resultQuality: 'UNKNOWN',
      scheduledAt: new Date('2026-07-25T08:00:00Z'),
      homeTeamId: 'team-a',
      awayTeamId: 'team-b',
      isSimulation: false,
      stageId: 'pool-stage',
      stage: { isPublished: false },
      competition: draftGlasgow,
      dataCoverage: [],
    });
  });

  it('keeps the DRAFT edition out of directories, exact resolvers, navigation and public APIs', async () => {
    const publicCompetitions = await getPublicCompetitions();
    expect(publicCompetitions.map((edition) => edition.id)).toEqual([publicEdition.id]);
    await expect(resolveEdition(GLASGOW_2026_IDENTITY)).resolves.toMatchObject({ edition: null });
    await expect(resolveCompetitionById(draftGlasgow.id)).resolves.toMatchObject({ competition: null });

    expect(toEditionContexts(publicCompetitions).map((edition) => edition.id)).toEqual([publicEdition.id]);
    expect(getVisibleNavigationItems({ analyticsEnabled: true, askCentrePassEnabled: true }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ href: '/admin/preview/glasgow-2026' })]));

    const matchesResponse = await getMatches(new Request(
      `https://centrepass.test/api/matches?edition=${draftGlasgow.id}`,
    ));
    expect(matchesResponse.status).toBe(404);
    expect(mocks.completedMatchesPage).not.toHaveBeenCalled();

    const teamsResponse = await getTeams();
    expect(teamsResponse.status).toBe(200);
    expect(mocks.teamFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        OR: [
          { competitionId: { in: [publicEdition.id] } },
          { editionEntries: { some: { competitionId: { in: [publicEdition.id] } } } },
        ],
      },
    }));
  });

  it('keeps DRAFT matches inaccessible and sitemap queries restricted to public edition IDs', async () => {
    await expect(resolvePublicMatchAccess('glasgow-draft-match')).resolves.toBeNull();

    const entries = await sitemap();
    expect(entries.map((entry) => entry.url).join('\n')).not.toContain('glasgow');
    expect(entries.map((entry) => entry.url)).toEqual(expect.arrayContaining([
      'https://centrepass.io/team/public-team',
      'https://centrepass.io/match/public-match-id?edition=ssn-public-id',
      'https://centrepass.io/player/public-player-id',
    ]));
    expect(mocks.matchFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ competitionId: { in: [publicEdition.id] } }),
    }));
    expect(mocks.playerFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { team: { competitionId: { in: [publicEdition.id] } } },
          { rosterMemberships: { some: { editionEntry: { competitionId: { in: [publicEdition.id] } } } } },
        ],
      },
    }));
  });

  it('distinguishes pre-publication readiness from public visibility without mutating state', () => {
    expect(isEditionPubliclyReady(draftGlasgow)).toBe(false);
    expect(evaluateGlasgowPublishedVisibility({
      publicationStatus: draftGlasgow.publicationStatus,
      teamCount: draftGlasgow._count.entries,
      matchCount: draftGlasgow._count.matches,
      matchSlotCount: 76,
      cleanSuccessfulImportCount: 1,
      stages: draftStages.map((stage) => ({
        slug: stage.slug,
        type: stage.type,
        sequence: stage.sequence,
        isPublished: stage.isPublished,
        groupCount: stage._count.groups,
        matchCount: stage._count.matches,
      })),
    }).ready).toBe(false);

    expect(evaluateEditionPublicationReadiness({
      competitionSlug: GLASGOW_2026_IDENTITY.competitionSlug,
      editionSlug: GLASGOW_2026_IDENTITY.editionSlug,
      publicationStatus: draftGlasgow.publicationStatus,
      teamCount: draftGlasgow._count.entries,
      matchCount: draftGlasgow._count.matches,
      matchSlotCount: 76,
      activeRosterCount: 96,
      cleanSuccessfulImportCount: 1,
      expectedImportChecksum: 'verified-checksum',
      latestAppliedImportChecksum: 'verified-checksum',
      latestCleanDryRunChecksum: 'verified-checksum',
      sourceMappingsComplete: true,
      provenanceComplete: true,
      coverageComplete: true,
      unresolvedValidationIssueCount: 0,
      stages: draftStages.map((stage) => ({
        slug: stage.slug,
        type: stage.type,
        sequence: stage.sequence,
        isPublished: stage.isPublished,
        groupCount: stage._count.groups,
        matchCount: stage._count.matches,
      })),
    })).toEqual({ ready: true, blockers: [] });
  });
});
