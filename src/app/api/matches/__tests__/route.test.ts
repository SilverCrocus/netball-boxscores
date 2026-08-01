import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loadPageMock,
  resolveCompetitionMock,
  resolveCompetitionByIdMock,
  resolveEditionMock,
  resolveLegacyLeagueCompetitionMock,
  getScheduleMock,
} = vi.hoisted(() => ({
  loadPageMock: vi.fn(),
  resolveCompetitionMock: vi.fn(),
  resolveCompetitionByIdMock: vi.fn(),
  resolveEditionMock: vi.fn(),
  resolveLegacyLeagueCompetitionMock: vi.fn(),
  getScheduleMock: vi.fn(),
}));

vi.mock('@/lib/competitions', () => ({
  resolveCompetition: resolveCompetitionMock,
  resolveCompetitionById: resolveCompetitionByIdMock,
  resolveEdition: resolveEditionMock,
  resolveLegacyLeagueCompetition: resolveLegacyLeagueCompetitionMock,
}));
vi.mock('@/lib/home-feed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/home-feed')>(),
  getCompletedMatchesPage: loadPageMock,
}));
vi.mock('@/lib/edition-schedule', () => ({ getEditionSchedule: getScheduleMock }));

import { GET } from '../route';

describe('GET /api/matches', () => {
  beforeEach(() => {
    resolveCompetitionMock.mockReset().mockResolvedValue({
      competition: { id: 'competition-2026', season: 2026 },
    });
    resolveCompetitionByIdMock.mockReset().mockResolvedValue({
      competition: { id: 'glasgow-2026', season: 2026 },
    });
    resolveEditionMock.mockReset().mockResolvedValue({
      edition: { id: 'glasgow-2026', season: 2026 },
    });
    resolveLegacyLeagueCompetitionMock.mockReset().mockResolvedValue({
      competition: { id: 'competition-2026', season: 2026 },
    });
    loadPageMock.mockReset().mockResolvedValue({ groups: [], nextCursor: null });
    getScheduleMock.mockReset();
  });

  it('prefers a canonical edition id when competitions share a year', async () => {
    const response = await GET(new Request('https://centrepass.test/api/matches?edition=glasgow-2026&season=2026'));

    expect(response.status).toBe(200);
    expect(resolveCompetitionByIdMock).toHaveBeenCalledWith('glasgow-2026');
    expect(resolveCompetitionMock).not.toHaveBeenCalled();
    expect(loadPageMock).toHaveBeenCalledWith(
      'glasgow-2026',
      undefined,
      [{ id: 'glasgow-2026', season: 2026 }],
    );
  });

  it('resolves an exact canonical competition and edition slug pair', async () => {
    const response = await GET(new Request(
      'https://centrepass.test/api/matches?competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026&edition=other-id&season=2026',
    ));

    expect(response.status).toBe(200);
    expect(resolveEditionMock).toHaveBeenCalledWith({
      competitionSlug: 'commonwealth-games-netball',
      editionSlug: 'glasgow-2026',
    });
    expect(resolveCompetitionByIdMock).not.toHaveBeenCalled();
    expect(resolveLegacyLeagueCompetitionMock).not.toHaveBeenCalled();
    expect(loadPageMock).toHaveBeenCalledWith(
      'glasgow-2026',
      undefined,
      [{ id: 'glasgow-2026', season: 2026 }],
    );
  });

  it('opts into a sorted, resolved five-fixture schedule for an exact edition', async () => {
    const team = (name: string) => ({
      id: name.toLowerCase(),
      name,
      slug: name.toLowerCase(),
      abbreviation: name.slice(0, 3).toUpperCase(),
      logoUrl: null,
    });
    const fixture = (
      id: string,
      scheduledAt: string,
      options: { status?: string; resolved?: boolean } = {},
    ) => ({
      id,
      scheduledAt: new Date(scheduledAt),
      status: options.status ?? 'SCHEDULED',
      venue: 'The Hydro',
      sideA: {
        resolved: options.resolved ?? true,
        team: options.resolved === false ? null : team('England'),
      },
      sideB: { resolved: true, team: team('Scotland') },
    });
    const edition = { id: 'glasgow-2026', season: 2026 };
    resolveEditionMock.mockResolvedValue({ edition });
    getScheduleMock.mockResolvedValue({
      editionId: 'glasgow-2026',
      stages: [{
        dates: [{
          fixtures: [
            fixture('sixth', '2099-08-06T12:00:00.000Z'),
            fixture('match/a?b', '2099-08-01T12:00:00.000Z'),
            fixture('third', '2099-08-03T12:00:00.000Z'),
            fixture('second', '2099-08-02T12:00:00.000Z'),
            fixture('fifth', '2099-08-05T12:00:00.000Z'),
            fixture('fourth', '2099-08-04T12:00:00.000Z'),
            fixture('past', '2020-08-01T12:00:00.000Z'),
            fixture('live', '2099-08-01T11:00:00.000Z', { status: 'LIVE' }),
            fixture('unresolved', '2099-08-01T10:00:00.000Z', { resolved: false }),
          ],
        }],
      }],
    });

    const response = await GET(new Request(
      'https://centrepass.test/api/matches?competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026&includeUpcoming=true',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getScheduleMock).toHaveBeenCalledWith(edition);
    expect(payload.upcomingFixtures.map((item: { id: string }) => item.id)).toEqual([
      'match/a?b',
      'second',
      'third',
      'fourth',
      'fifth',
    ]);
    expect(payload.upcomingFixtures[0]).toMatchObject({
      competitionId: 'glasgow-2026',
      href: '/match/match%2Fa%3Fb?edition=glasgow-2026',
      status: 'SCHEDULED',
      homeTeam: { name: 'England' },
      awayTeam: { name: 'Scotland' },
    });
  });

  it.each([
    'competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026',
    'edition=glasgow-2026&includeUpcoming=true',
    'competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026&includeUpcoming=true&cursor=next',
    'competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026&includeUpcoming=true&cursor=',
  ])('does not load upcoming fixtures outside the exact opt-in contract: %s', async (query) => {
    const response = await GET(new Request(`https://centrepass.test/api/matches?${query}`));

    expect(response.status).toBe(200);
    expect(getScheduleMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.not.toHaveProperty('upcomingFixtures');
  });

  it('preserves completed results when the optional schedule is unavailable', async () => {
    loadPageMock.mockResolvedValue({
      groups: [{ label: 'Pool A', matches: [] }],
      nextCursor: null,
    });
    getScheduleMock.mockRejectedValue(new Error('schedule unavailable'));

    const response = await GET(new Request(
      'https://centrepass.test/api/matches?competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026&includeUpcoming=true',
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      groups: [{ label: 'Pool A', matches: [] }],
      nextCursor: null,
    });
  });

  it.each([
    'competitionSlug=commonwealth-games-netball',
    'editionSlug=glasgow-2026',
  ])('rejects an incomplete canonical edition identity: %s', async (query) => {
    const response = await GET(new Request(`https://centrepass.test/api/matches?${query}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_EDITION_IDENTITY', retryable: false },
    });
    expect(resolveEditionMock).not.toHaveBeenCalled();
    expect(loadPageMock).not.toHaveBeenCalled();
  });

  it('resolves the requested season and forwards the cursor', async () => {
    const response = await GET(new Request('https://centrepass.test/api/matches?season=2026&cursor=next-page'));

    expect(response.status).toBe(200);
    expect(resolveLegacyLeagueCompetitionMock).toHaveBeenCalledWith('2026');
    expect(loadPageMock).toHaveBeenCalledWith(
      'competition-2026',
      'next-page',
      [{ id: 'competition-2026', season: 2026 }],
    );
  });

  it('returns a typed client error for an invalid cursor', async () => {
    loadPageMock.mockRejectedValue(new Error('INVALID_CURSOR'));

    const response = await GET(new Request('https://centrepass.test/api/matches?cursor=bad'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_CURSOR', retryable: false },
    });
  });

  it('returns a retryable typed error when data is unavailable', async () => {
    resolveCompetitionMock.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new Request('https://centrepass.test/api/matches'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'RESULTS_UNAVAILABLE', retryable: true },
    });
  });
});
