import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock, resolvePublicMatchBatchMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  resolvePublicMatchBatchMock: vi.fn(),
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
  resolvePublicMatchAccessBatch: resolvePublicMatchBatchMock,
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
    resolvePublicMatchBatchMock.mockReset().mockResolvedValue(new Map());
  });

  it('filters every candidate through the full public resolver', async () => {
    findManyMock.mockResolvedValue([match('public'), match('private')]);
    resolvePublicMatchBatchMock.mockResolvedValue(new Map([
      ['public', { id: 'public', status: 'COMPLETED', scoreAvailable: true }],
    ]));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ id: 'public', scoreAvailable: true }),
    ]);
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(['public', 'private']);
  });

  it('hides unsafe scores and non-live clock fields instead of returning zero-like data', async () => {
    findManyMock.mockResolvedValue([match('unverified')]);
    resolvePublicMatchBatchMock.mockResolvedValue(new Map([['unverified', {
      id: 'unverified', status: 'COMPLETED', scoreAvailable: false,
    }]]));

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
    resolvePublicMatchBatchMock.mockResolvedValue(new Map([['live', {
      id: 'live', status: 'LIVE', scoreAvailable: true,
    }]]));

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
    resolvePublicMatchBatchMock.mockRejectedValue(new Error('lookup failed'));

    const response = await GET();

    await expect(response.json()).resolves.toEqual([]);
  });
});
