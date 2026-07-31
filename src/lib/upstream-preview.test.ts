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
      nextCursor: 'older-results',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://centrepass.example/api/matches?competitionSlug=commonwealth-games-netball&editionSlug=glasgow-2026',
      expect.any(Object),
    );
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
