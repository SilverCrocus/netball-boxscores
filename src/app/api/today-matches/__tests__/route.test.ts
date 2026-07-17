import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock, resolvePublicMatchMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  resolvePublicMatchMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: {},
  prisma: { match: { findMany: findManyMock } },
}));
vi.mock('@/lib/time-zone', () => ({
  getSydneyDayBounds: () => ({
    start: new Date('2026-07-25T00:00:00Z'),
    end: new Date('2026-07-26T00:00:00Z'),
  }),
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccess: resolvePublicMatchMock,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));

import { GET } from '../route';

function match(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'COMPLETED',
    homeScore: 60,
    awayScore: 55,
    currentQuarter: 4,
    currentTime: '0',
    scheduledAt: new Date('2026-07-25T08:00:00Z'),
    ...overrides,
  };
}

describe('GET /api/today-matches', () => {
  beforeEach(() => {
    findManyMock.mockReset().mockResolvedValue([]);
    resolvePublicMatchMock.mockReset();
  });

  it('filters every candidate through the full public resolver', async () => {
    findManyMock.mockResolvedValue([match('public'), match('private')]);
    resolvePublicMatchMock.mockImplementation(async (id: string) => id === 'public'
      ? { id, status: 'COMPLETED', scoreAvailable: true }
      : null);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ id: 'public', scoreAvailable: true }),
    ]);
    expect(resolvePublicMatchMock).toHaveBeenCalledTimes(2);
  });

  it('hides unsafe scores and non-live clock fields instead of returning zero-like data', async () => {
    findManyMock.mockResolvedValue([match('unverified')]);
    resolvePublicMatchMock.mockResolvedValue({
      id: 'unverified',
      status: 'COMPLETED',
      scoreAvailable: false,
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: 'unverified',
        homeScore: null,
        awayScore: null,
        currentQuarter: null,
        currentTime: null,
        scoreAvailable: false,
      }),
    ]);
  });

  it('returns current clock details only for a score-safe live match', async () => {
    findManyMock.mockResolvedValue([match('live', {
      status: 'LIVE', currentQuarter: 2, currentTime: '312',
    })]);
    resolvePublicMatchMock.mockResolvedValue({
      id: 'live',
      status: 'LIVE',
      scoreAvailable: true,
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        id: 'live',
        homeScore: 60,
        awayScore: 55,
        currentQuarter: 2,
        currentTime: '312',
        scoreAvailable: true,
      }),
    ]);
  });

  it('fails a candidate closed when access resolution errors', async () => {
    findManyMock.mockResolvedValue([match('lookup-error')]);
    resolvePublicMatchMock.mockRejectedValue(new Error('lookup failed'));

    const response = await GET();

    await expect(response.json()).resolves.toEqual([]);
  });
});
