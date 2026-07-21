import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findManyMock, resolvePublicMatchBatchMock, publicMatchBatchSelectMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  resolvePublicMatchBatchMock: vi.fn(),
  publicMatchBatchSelectMock: { id: true, competitionId: true, scheduledAt: true },
}));

vi.mock('@/lib/db', () => ({
  prisma: { match: { findMany: findManyMock } },
  excludeSimData: {},
}));
vi.mock('@/lib/public-match', () => ({
  publicMatchBatchSelect: publicMatchBatchSelectMock,
  resolvePublicMatchAccessBatch: resolvePublicMatchBatchMock,
}));

import { getLiveState, liveMatchSelect, MAX_LIVE_STATE_CANDIDATES } from '@/lib/live-state';

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
    resolvePublicMatchBatchMock.mockReset().mockResolvedValue(new Map());
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
    resolvePublicMatchBatchMock.mockImplementation(async (ids: string[]) => {
      const resolved = new Map();
      for (const id of ids) {
        if (id === 'unpublished-stage') continue;
        resolved.set(id, access(id, id === 'live' ? 'LIVE' : id === 'imminent' ? 'SCHEDULED' : 'COMPLETED'));
      }
      return resolved;
    });

    const state = await getLiveState();

    expect(state).toEqual({
      liveMatches: [{ id: 'live', competitionId: 'ssn-2026' }],
      liveMatchIds: ['live'],
      imminentMatchIds: ['imminent'],
      nextMatchAt: new Date('2026-07-25T08:30:00Z'),
      isMatchDay: true,
    });
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledOnce();
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['live', 'imminent', 'completed', 'unpublished-stage'],
      undefined,
      undefined,
    );
  });

  it('fails access errors and published-but-unready candidates closed', async () => {
    findManyMock.mockResolvedValue([
      candidate('unready'),
      candidate('lookup-error'),
    ]);
    resolvePublicMatchBatchMock.mockRejectedValue(new Error('database unavailable'));

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
      select: publicMatchBatchSelectMock,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: MAX_LIVE_STATE_CANDIDATES,
    }));
    expect(findManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('competition');
  });

  it('uses the reusable full match projection when live details are requested', async () => {
    await getLiveState({ includeMatchDetails: true });

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      select: liveMatchSelect,
    }));
    expect(liveMatchSelect).toHaveProperty('stageId', true);
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
