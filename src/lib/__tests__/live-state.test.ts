import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLiveState } from '@/lib/live-state';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
  excludeSimData: {},
}));

import { prisma } from '@/lib/db';

const mockFindMany = vi.mocked(prisma.match.findMany);
const mockFindFirst = vi.mocked(prisma.match.findFirst);
const mockCount = vi.mocked(prisma.match.count);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLiveState', () => {
  it('returns live match IDs when matches have status LIVE', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'match-1' },
      { id: 'match-2' },
    ] as any);
    mockFindMany.mockResolvedValueOnce([]); // imminent
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.liveMatchIds).toEqual(['match-1', 'match-2']);
  });

  it('returns imminent match IDs for SCHEDULED matches within ±60min', async () => {
    mockFindMany.mockResolvedValueOnce([]); // live
    mockFindMany.mockResolvedValueOnce([
      { id: 'match-3' },
    ] as any);
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.imminentMatchIds).toEqual(['match-3']);
  });

  it('returns nextMatchAt for nearest SCHEDULED match within 1 hour', async () => {
    const nextTime = new Date('2026-04-19T12:00:00Z');
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindFirst.mockResolvedValueOnce({ scheduledAt: nextTime } as any);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.nextMatchAt).toEqual(nextTime);
  });

  it('returns isMatchDay true when matches are scheduled today', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(3);

    const state = await getLiveState();

    expect(state.isMatchDay).toBe(true);
  });

  it('returns all-empty state when no matches', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.liveMatchIds).toEqual([]);
    expect(state.imminentMatchIds).toEqual([]);
    expect(state.nextMatchAt).toBeNull();
    expect(state.isMatchDay).toBe(false);
  });
});
