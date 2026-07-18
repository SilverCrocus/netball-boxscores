import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isUpstreamPreviewMode,
  loadUpstreamCompletedMatches,
  loadUpstreamLiveStatus,
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

  it('normalizes public results and gives them working hosted links', async () => {
    process.env.CENTREPASS_PREVIEW_DATA_MODE = 'upstream';
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://centrepass.example';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [{
          label: 'Grand Final',
          matches: [{
            id: 'match-1',
            status: 'COMPLETED',
            scoreAvailable: true,
            scheduledAt: '2026-07-04T09:30:00.000Z',
            homeScore: 61,
            awayScore: 40,
            venue: 'John Cain Arena',
            round: 3,
            finalCode: 'GRAND',
            homeTeam: { name: 'Thunderbirds', abbreviation: 'THU', logoUrl: null },
            awayTeam: { name: 'Vixens', abbreviation: 'VIX', logoUrl: null },
            homeBreakdown: null,
            awayBreakdown: null,
          }],
        }],
        nextCursor: 'older-results',
      }),
    }));

    const result = await loadUpstreamCompletedMatches();

    expect(result).toMatchObject({
      groups: [{
        label: 'Grand Final',
        matches: [{ href: 'https://centrepass.example/match/match-1', homeScore: 61, awayScore: 40 }],
      }],
      nextCursor: 'older-results',
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
