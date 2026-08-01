import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  glasgowUpstreamResultsParams,
  isUpstreamPreviewMode,
  loadUpstreamCompletedMatches,
  loadUpstreamLiveStatus,
  upstreamPreviewOrigin,
} from './upstream-preview';

const originalMode = process.env.CENTREPASS_PREVIEW_DATA_MODE;
const originalOrigin = process.env.CENTREPASS_UPSTREAM_ORIGIN;

describe('upstream preview data', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalMode === undefined) delete process.env.CENTREPASS_PREVIEW_DATA_MODE;
    else process.env.CENTREPASS_PREVIEW_DATA_MODE = originalMode;
    if (originalOrigin === undefined) delete process.env.CENTREPASS_UPSTREAM_ORIGIN;
    else process.env.CENTREPASS_UPSTREAM_ORIGIN = originalOrigin;
  });

  it('stays disabled unless development preview mode is explicit', () => {
    delete process.env.CENTREPASS_PREVIEW_DATA_MODE;
    expect(isUpstreamPreviewMode()).toBe(false);
  });

  it('normalizes the configured navigation origin and rejects unsafe schemes', () => {
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://centrepass.example/some/path?ignored=true';
    expect(upstreamPreviewOrigin()).toBe('https://centrepass.example');

    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'javascript:alert(1)';
    expect(upstreamPreviewOrigin()).toBeNull();
  });

  it('normalizes public results and gives them working hosted links', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://centrepass.example';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [{
          label: 'Pool A — 2026-07-30',
          matches: [{
            id: 'match-1',
            status: 'COMPLETED',
            scoreAvailable: true,
            scheduledAt: '2026-07-30T20:00:00.000Z',
            homeScore: 58,
            awayScore: 54,
            venue: 'The Hydro',
            round: null,
            homeTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
            awayTeam: { name: 'South Africa', abbreviation: 'RSA', logoUrl: null },
            homeBreakdown: null,
            awayBreakdown: null,
          }],
        }],
        upcomingFixtures: [{
          id: 'hosted/fixture?one',
          competitionId: 'glasgow-2026',
          href: 'javascript:alert(1)',
          status: 'SCHEDULED',
          scheduledAt: '2099-08-01T12:00:00.000Z',
          venue: 'The Hydro',
          homeTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
          awayTeam: { name: 'Scotland', abbreviation: 'SCO', logoUrl: null },
        }],
        nextCursor: 'older-results',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadUpstreamCompletedMatches(glasgowUpstreamResultsParams());

    expect(result).toMatchObject({
      groups: [{
        label: 'Pool A — 2026-07-30',
        matches: [{ href: 'https://centrepass.example/match/match-1', homeScore: 58, awayScore: 54 }],
      }],
      upcomingFixtures: [{
        id: 'hosted/fixture?one',
        href: 'https://centrepass.example/match/hosted%2Ffixture%3Fone?edition=glasgow-2026',
        homeTeam: { name: 'England' },
        awayTeam: { name: 'Scotland' },
      }],
      nextCursor: 'older-results',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://centrepass.example/api/matches?competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026&includeUpcoming=true',
      expect.any(Object),
    );
  });

  it('preserves omitted or invalid hosted fixtures for the static fallback', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://centrepass.example';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ groups: [], nextCursor: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          groups: [],
          nextCursor: null,
          upcomingFixtures: [{ id: 'malformed-fixture' }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const omitted = await loadUpstreamCompletedMatches(glasgowUpstreamResultsParams());
    const invalid = await loadUpstreamCompletedMatches(glasgowUpstreamResultsParams());

    expect(omitted).not.toHaveProperty('upcomingFixtures');
    expect(invalid).not.toHaveProperty('upcomingFixtures');
  });

  it('keeps an explicit empty hosted fixture list authoritative', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [],
        nextCursor: null,
        upcomingFixtures: [],
      }),
    }));

    await expect(loadUpstreamCompletedMatches(glasgowUpstreamResultsParams()))
      .resolves.toMatchObject({ upcomingFixtures: [] });
  });

  it('keeps the hosted fixture list authoritative after filtering non-Glasgow teams', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [],
        nextCursor: null,
        upcomingFixtures: [{
          id: 'ssn-fixture',
          competitionId: 'glasgow-2026',
          status: 'SCHEDULED',
          scheduledAt: '2099-08-01T12:00:00.000Z',
          venue: 'John Cain Arena',
          homeTeam: { name: 'Adelaide Thunderbirds', abbreviation: 'THU', logoUrl: null },
          awayTeam: { name: 'Melbourne Vixens', abbreviation: 'VIX', logoUrl: null },
        }],
      }),
    }));

    const result = await loadUpstreamCompletedMatches(glasgowUpstreamResultsParams());

    expect(result).toMatchObject({ upcomingFixtures: [] });
  });

  it('retains allowed Glasgow fixtures while filtering foreign teams', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [],
        nextCursor: null,
        upcomingFixtures: [
          {
            id: 'glasgow-fixture',
            competitionId: 'glasgow-2026',
            status: 'SCHEDULED',
            scheduledAt: '2099-08-01T12:00:00.000Z',
            venue: 'The Hydro',
            homeTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
            awayTeam: { name: 'Scotland', abbreviation: 'SCO', logoUrl: null },
          },
          {
            id: 'ssn-fixture',
            competitionId: 'glasgow-2026',
            status: 'SCHEDULED',
            scheduledAt: '2099-08-01T13:00:00.000Z',
            venue: 'John Cain Arena',
            homeTeam: { name: 'Adelaide Thunderbirds', abbreviation: 'THU', logoUrl: null },
            awayTeam: { name: 'Melbourne Vixens', abbreviation: 'VIX', logoUrl: null },
          },
        ],
      }),
    }));

    const result = await loadUpstreamCompletedMatches(glasgowUpstreamResultsParams());

    expect(result?.upcomingFixtures).toEqual([
      expect.objectContaining({ id: 'glasgow-fixture' }),
    ]);
  });

  it('filters hosted results that do not belong to the Glasgow team set', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://centrepass.example';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [{
          label: 'Grand Final',
          matches: [{
            id: 'ssn-grand-final',
            status: 'COMPLETED',
            scoreAvailable: true,
            scheduledAt: '2026-07-04T09:30:00.000Z',
            homeScore: 61,
            awayScore: 40,
            venue: 'John Cain Arena',
            round: 3,
            finalCode: 'GRAND',
            homeTeam: { name: 'Adelaide Thunderbirds', abbreviation: 'THU', logoUrl: null },
            awayTeam: { name: 'Melbourne Vixens', abbreviation: 'VIX', logoUrl: null },
          }],
        }],
        nextCursor: 'older-ssn-results',
      }),
    }));

    await expect(loadUpstreamCompletedMatches(glasgowUpstreamResultsParams())).resolves.toEqual({
      groups: [],
      nextCursor: null,
    });
  });

  it('returns a safe live status response', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hasLive: false, nextMatchAt: null }),
    }));

    await expect(loadUpstreamLiveStatus()).resolves.toEqual({
      hasLive: false,
      nextMatchAt: null,
    });
  });
});
