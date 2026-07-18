import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock, resolvePublicMatchMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  resolvePublicMatchMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { match: { findMany: findManyMock } },
  excludeSimData: {},
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccess: resolvePublicMatchMock,
}));

import { getLiveState } from '@/lib/live-state';

const NOW = new Date('2026-07-25T08:00:00Z');

function candidate(id: string, scheduledAt = NOW, competitionId = 'ssn-2026') {
  return { id, competitionId, scheduledAt };
}

function access(id: string, status: 'LIVE' | 'SCHEDULED' | 'COMPLETED') {
  return { id, status };
}

describe('getLiveState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    findManyMock.mockReset().mockResolvedValue([]);
    resolvePublicMatchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives live, imminent, next, and match-day state only from fully public matches', async () => {
    findManyMock.mockResolvedValue([
      candidate('live', new Date('2026-07-25T07:45:00Z')),
      candidate('imminent', new Date('2026-07-25T08:30:00Z'), 'glasgow-2026'),
      candidate('completed', new Date('2026-07-25T06:00:00Z')),
      candidate('unpublished-stage', new Date('2026-07-25T08:15:00Z')),
    ]);
    resolvePublicMatchMock.mockImplementation(async (id: string) => {
      if (id === 'unpublished-stage') return null;
      if (id === 'live') return access(id, 'LIVE');
      if (id === 'imminent') return access(id, 'SCHEDULED');
      return access(id, 'COMPLETED');
    });

    const state = await getLiveState();

    expect(state).toEqual({
      liveMatches: [{ id: 'live', competitionId: 'ssn-2026' }],
      liveMatchIds: ['live'],
      imminentMatchIds: ['imminent'],
      nextMatchAt: new Date('2026-07-25T08:30:00Z'),
      isMatchDay: true,
    });
    expect(resolvePublicMatchMock).toHaveBeenCalledTimes(4);
  });

  it('fails access errors and published-but-unready candidates closed', async () => {
    findManyMock.mockResolvedValue([
      candidate('unready'),
      candidate('lookup-error'),
    ]);
    resolvePublicMatchMock.mockImplementation(async (id: string) => {
      if (id === 'lookup-error') throw new Error('database unavailable');
      return null;
    });

    await expect(getLiveState()).resolves.toEqual({
      liveMatches: [],
      liveMatchIds: [],
      imminentMatchIds: [],
      nextMatchAt: null,
      isMatchDay: false,
    });
  });

  it('queries a bounded candidate window and delegates publication policy to the resolver', async () => {
    await getLiveState();

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { status: 'LIVE' },
          expect.objectContaining({ scheduledAt: expect.any(Object) }),
        ]),
      }),
      select: { id: true, competitionId: true, scheduledAt: true },
    }));
    expect(findManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('competition');
  });

  it('returns all-empty state when there are no candidates', async () => {
    await expect(getLiveState()).resolves.toEqual({
      liveMatches: [],
      liveMatchIds: [],
      imminentMatchIds: [],
      nextMatchAt: null,
      isMatchDay: false,
    });
  });
});
