import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLiveStatusMock, isUpstreamPreviewModeMock, loadUpstreamLiveStatusMock } = vi.hoisted(() => ({
  getLiveStatusMock: vi.fn(),
  isUpstreamPreviewModeMock: vi.fn(),
  loadUpstreamLiveStatusMock: vi.fn(),
}));

vi.mock('@/lib/live-state', () => ({ getLiveStatus: getLiveStatusMock }));
vi.mock('@/lib/upstream-preview', () => ({
  isUpstreamPreviewMode: isUpstreamPreviewModeMock,
  loadUpstreamLiveStatus: loadUpstreamLiveStatusMock,
}));

import { GET } from '../route';

describe('GET /api/live-status', () => {
  beforeEach(() => {
    getLiveStatusMock.mockReset().mockResolvedValue({
      hasLive: true,
      nextMatchAt: new Date('2026-07-25T08:30:00Z'),
    });
    isUpstreamPreviewModeMock.mockReset().mockReturnValue(false);
    loadUpstreamLiveStatusMock.mockReset();
  });

  it('uses the narrow uncached status loader and preserves no-store headers', async () => {
    const response = await GET();

    expect(getLiveStatusMock).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      hasLive: true,
      nextMatchAt: '2026-07-25T08:30:00.000Z',
    });
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate');
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('retains the upstream preview override before querying local status', async () => {
    isUpstreamPreviewModeMock.mockReturnValue(true);
    loadUpstreamLiveStatusMock.mockResolvedValue({
      hasLive: false,
      nextMatchAt: null,
    });

    const response = await GET();

    expect(await response.json()).toEqual({ hasLive: false, nextMatchAt: null });
    expect(getLiveStatusMock).not.toHaveBeenCalled();
  });
});
