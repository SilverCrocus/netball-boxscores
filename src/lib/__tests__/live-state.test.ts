import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findManyMock,
  resolvePublicMatchBatchMock,
  publicMatchBatchSelectMock,
  transactionMock,
  transactionState,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  resolvePublicMatchBatchMock: vi.fn(),
  publicMatchBatchSelectMock: { id: true, competitionId: true, scheduledAt: true },
  transactionMock: vi.fn(),
  transactionState: { active: false },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findMany: findManyMock },
    $transaction: transactionMock,
  },
  excludeSimData: {},
}));
vi.mock('@/lib/public-match', () => ({
  publicMatchBatchSelect: publicMatchBatchSelectMock,
  resolvePublicMatchAccessBatch: resolvePublicMatchBatchMock,
}));

import {
  getLiveState,
  getLiveStatus,
  liveMatchSelect,
  MAX_LIVE_STATE_CANDIDATES,
} from '@/lib/live-state';

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
    transactionMock.mockReset().mockImplementation(async (
      operation: (transaction: { match: { findMany: typeof findManyMock } }) => Promise<unknown>,
    ) => {
      transactionState.active = true;
      try {
        return await operation({ match: { findMany: findManyMock } });
      } finally {
        transactionState.active = false;
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives live, imminent, next, and match-day state only from fully public matches', async () => {
    findManyMock
      .mockResolvedValueOnce([
        candidate('live', new Date('2026-07-25T07:45:00Z')),
      ])
      .mockResolvedValueOnce([
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

    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(findManyMock.mock.calls[0]?.[0]).toMatchObject({
      where: expect.objectContaining({ status: 'LIVE' }),
      select: publicMatchBatchSelectMock,
      relationLoadStrategy: 'join',
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: MAX_LIVE_STATE_CANDIDATES,
    });
    expect(findManyMock.mock.calls[1]?.[0]).toMatchObject({
      where: expect.objectContaining({
        status: { not: 'LIVE' },
        scheduledAt: expect.any(Object),
      }),
      select: publicMatchBatchSelectMock,
      relationLoadStrategy: 'join',
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: MAX_LIVE_STATE_CANDIDATES,
    });
    expect(findManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty('competition');
  });

  it('uses the reusable full match projection when live details are requested', async () => {
    await getLiveState({ includeMatchDetails: true });

    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(findManyMock.mock.calls[0]?.[0]).toMatchObject({ select: liveMatchSelect });
    expect(findManyMock.mock.calls[1]?.[0]).toMatchObject({ select: liveMatchSelect });
    expect(liveMatchSelect).toHaveProperty('stageId', true);
  });

  it('can skip the non-live window when the page only needs live details', async () => {
    const live = candidate('live', new Date('2026-07-25T08:00:00Z'));
    findManyMock.mockResolvedValueOnce([live]);
    resolvePublicMatchBatchMock.mockResolvedValue(new Map([
      ['live', access('live', 'LIVE')],
    ]));

    const state = await getLiveState({
      includeMatchDetails: true,
      includeWindowCandidates: false,
    });

    expect(state.liveMatchIds).toEqual(['live']);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(findManyMock.mock.calls[0]?.[0]).toMatchObject({ select: liveMatchSelect });
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['live'],
      undefined,
      [live],
    );
  });

  it('prioritizes later LIVE rows before filling the bounded window budget', async () => {
    const laterLive = candidate('later-live', new Date('2026-07-25T23:00:00Z'));
    const nonLiveCandidates = Array.from(
      { length: MAX_LIVE_STATE_CANDIDATES },
      (_, index) => candidate(
        `scheduled-${index}`,
        new Date(NOW.getTime() + index * 1_000),
      ),
    );
    findManyMock.mockImplementation(({
      where,
      take,
    }: { where: { status?: unknown }; take: number }) => Promise.resolve(
      where.status === 'LIVE'
        ? [laterLive]
        : nonLiveCandidates.slice(0, take),
    ));
    resolvePublicMatchBatchMock.mockImplementation(async (ids: string[]) => new Map(
      ids.map((id) => [id, access(id, id === 'later-live' ? 'LIVE' : 'COMPLETED')]),
    ));

    const state = await getLiveState();

    expect(state.liveMatches).toEqual([
      { id: 'later-live', competitionId: 'ssn-2026' },
    ]);
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(findManyMock.mock.calls[1]?.[0]).toMatchObject({
      take: MAX_LIVE_STATE_CANDIDATES - 1,
      where: expect.objectContaining({ status: { not: 'LIVE' } }),
    });
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['later-live', ...nonLiveCandidates.slice(0, MAX_LIVE_STATE_CANDIDATES - 1).map(({ id }) => id)],
      undefined,
      undefined,
    );
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

  it('uses only live and next-hour candidates for the shared status badge', async () => {
    const live = { ...candidate('live', new Date('2026-07-25T07:45:00Z')), status: 'LIVE' as const };
    const next = { ...candidate('next', new Date('2026-07-25T08:30:00Z')), status: 'SCHEDULED' as const };
    findManyMock.mockImplementation(({ where }: { where: { status?: string } }) => {
      if (where.status === 'LIVE') return Promise.resolve([live]);
      return Promise.resolve([next]);
    });
    resolvePublicMatchBatchMock.mockImplementation(async (
      _ids: string[],
      _editions: unknown,
      loadedMatches?: Array<{ id: string; status: 'LIVE' | 'SCHEDULED' }>,
    ) => new Map((loadedMatches ?? []).map((match) => [
      match.id,
      access(match.id, match.status),
    ])));

    await expect(getLiveStatus()).resolves.toEqual({
      hasLive: true,
      nextMatchAt: next.scheduledAt,
    });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(transactionMock.mock.calls[0]?.[1]).toMatchObject({
      isolationLevel: 'RepeatableRead',
      maxWait: 1_000,
      timeout: 5_000,
    });
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(findManyMock.mock.calls[0]?.[0]).toMatchObject({
      where: expect.objectContaining({ status: 'LIVE' }),
      select: publicMatchBatchSelectMock,
      relationLoadStrategy: 'join',
      take: MAX_LIVE_STATE_CANDIDATES,
    });
    expect(findManyMock.mock.calls[1]?.[0]).toMatchObject({
      where: expect.objectContaining({
        status: 'SCHEDULED',
        scheduledAt: expect.any(Object),
      }),
      select: publicMatchBatchSelectMock,
      relationLoadStrategy: 'join',
      take: MAX_LIVE_STATE_CANDIDATES,
    });
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['live', 'next'],
      undefined,
      [live, next],
    );
  });

  it('authoritatively resolves a LIVE-to-SCHEDULED same-id transition', async () => {
    const currentScheduled = { ...candidate('same-match', new Date('2026-07-25T08:30:00Z')), status: 'SCHEDULED' as const };
    findManyMock.mockImplementation(({ where }: { where: { status?: string } }) => {
      return where.status === 'SCHEDULED'
        ? Promise.resolve([currentScheduled])
        : Promise.resolve([]);
    });
    resolvePublicMatchBatchMock.mockImplementation(async (
      _ids: string[],
      _editions: unknown,
      loadedMatches?: Array<{ id: string; status: 'LIVE' | 'SCHEDULED' }>,
    ) => new Map((loadedMatches ?? []).map((match) => [match.id, access(match.id, match.status)])));

    await expect(getLiveStatus()).resolves.toEqual({
      hasLive: false,
      nextMatchAt: currentScheduled.scheduledAt,
    });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['same-match'],
      undefined,
      [currentScheduled],
    );
  });

  it('authoritatively resolves a SCHEDULED-to-LIVE same-id transition', async () => {
    const currentLive = { ...candidate('same-match', new Date('2026-07-25T07:45:00Z')), status: 'LIVE' as const };
    findManyMock.mockImplementation(({ where }: { where: { status?: string } }) => {
      return where.status === 'LIVE'
        ? Promise.resolve([currentLive])
        : Promise.resolve([]);
    });
    resolvePublicMatchBatchMock.mockImplementation(async (
      _ids: string[],
      _editions: unknown,
      loadedMatches?: Array<{ id: string; status: 'LIVE' | 'SCHEDULED' }>,
    ) => new Map((loadedMatches ?? []).map((match) => [match.id, access(match.id, match.status)])));

    await expect(getLiveStatus()).resolves.toEqual({
      hasLive: true,
      nextMatchAt: null,
    });
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['same-match'],
      undefined,
      [currentLive],
    );
  });

  it('uses one coherent snapshot when a SCHEDULED-to-LIVE transition would miss both branches', async () => {
    const currentScheduled = { ...candidate('missed-match', new Date('2026-07-25T08:30:00Z')), status: 'SCHEDULED' as const };
    let independentReadCount = 0;
    findManyMock.mockImplementation(({ where }: { where: { status?: string } }) => {
      if (!transactionState.active) {
        independentReadCount += 1;
        return Promise.resolve([]);
      }
      return where.status === 'SCHEDULED'
        ? Promise.resolve([currentScheduled])
        : Promise.resolve([]);
    });
    resolvePublicMatchBatchMock.mockImplementation(async (
      _ids: string[],
      _editions: unknown,
      loadedMatches?: Array<{ id: string; status: 'LIVE' | 'SCHEDULED' }>,
    ) => new Map((loadedMatches ?? []).map((match) => [match.id, access(match.id, match.status)])));

    await expect(getLiveStatus()).resolves.toEqual({
      hasLive: false,
      nextMatchAt: currentScheduled.scheduledAt,
    });
    expect(independentReadCount).toBe(0);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(transactionMock.mock.calls[0]?.[1]).toMatchObject({
      isolationLevel: 'RepeatableRead',
    });
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['missed-match'],
      undefined,
      [currentScheduled],
    );
  });

  it('uses one coherent snapshot when a LIVE-to-SCHEDULED transition would miss both branches', async () => {
    const currentLive = { ...candidate('missed-match', new Date('2026-07-25T07:45:00Z')), status: 'LIVE' as const };
    let independentReadCount = 0;
    findManyMock.mockImplementation(({ where }: { where: { status?: string } }) => {
      if (!transactionState.active) {
        independentReadCount += 1;
        return Promise.resolve([]);
      }
      return where.status === 'LIVE'
        ? Promise.resolve([currentLive])
        : Promise.resolve([]);
    });
    resolvePublicMatchBatchMock.mockImplementation(async (
      _ids: string[],
      _editions: unknown,
      loadedMatches?: Array<{ id: string; status: 'LIVE' | 'SCHEDULED' }>,
    ) => new Map((loadedMatches ?? []).map((match) => [match.id, access(match.id, match.status)])));

    await expect(getLiveStatus()).resolves.toEqual({
      hasLive: true,
      nextMatchAt: null,
    });
    expect(independentReadCount).toBe(0);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(transactionMock.mock.calls[0]?.[1]).toMatchObject({
      isolationLevel: 'RepeatableRead',
    });
    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledWith(
      ['missed-match'],
      undefined,
      [currentLive],
    );
  });

  it('fails closed for shared status when public access resolution is unavailable', async () => {
    findManyMock
      .mockResolvedValueOnce([candidate('live')])
      .mockResolvedValueOnce([candidate('next', new Date('2026-07-25T08:30:00Z'))]);
    resolvePublicMatchBatchMock.mockRejectedValue(new Error('database unavailable'));

    await expect(getLiveStatus()).resolves.toEqual({
      hasLive: false,
      nextMatchAt: null,
    });
  });
});
