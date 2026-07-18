import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestFromChampionData } from '@/lib/ingestion';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findMany: vi.fn() },
    pollLog: { create: vi.fn(), deleteMany: vi.fn() },
  },
  excludeSimData: {},
}));

vi.mock('@/lib/champion-data', () => ({
  fetchFixture: vi.fn(),
  fetchMatchStats: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats } from '@/lib/champion-data';

const mockFetchFixture = vi.mocked(fetchFixture);
const mockFetchMatchStats = vi.mocked(fetchMatchStats);
const mockPollLogCreate = vi.mocked(prisma.pollLog.create);
const mockPollLogDeleteMany = vi.mocked(prisma.pollLog.deleteMany);
const mockMatchFindMany = vi.mocked(prisma.match.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  mockPollLogDeleteMany.mockResolvedValue({ count: 0 });
});

describe('ingestFromChampionData', () => {
  it('stores fixture response in PollLog', async () => {
    const fixtureMatches = [
      { matchId: 100, matchStatus: 'scheduled' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(mockPollLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          competitionId: 12949,
          endpoint: 'fixture',
          status: 'success',
        }),
      }),
    );
    expect(result.fixture).toEqual(fixtureMatches);
  });

  it('fetches match details for playing matches and stores in PollLog', async () => {
    const fixtureMatches = [
      { matchId: 200, matchStatus: 'playing' },
    ];
    const matchDetail = {
      matchInfo: { matchId: 200, period: 2, periodSeconds: 450 },
    };
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockFetchMatchStats.mockResolvedValue(matchDetail as any);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(mockFetchMatchStats).toHaveBeenCalledWith(12949, 200);
    expect(result.matchDetails.get(200)).toEqual(matchDetail);
  });

  it('maps each match detail to its own PollLog entry', async () => {
    const fixtureMatches = [
      { matchId: 201, matchStatus: 'playing' },
      { matchId: 202, matchStatus: 'playing' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockFetchMatchStats.mockImplementation(async (_competitionId, matchId) => ({
      matchInfo: { matchId },
    }) as any);
    mockPollLogCreate
      .mockResolvedValueOnce({ id: 'fixture-log' } as any)
      .mockResolvedValueOnce({ id: 'match-201-log' } as any)
      .mockResolvedValueOnce({ id: 'match-202-log' } as any);

    const result = await ingestFromChampionData(12949);

    expect(result.matchPollLogIds).toEqual(new Map([
      [201, 'match-201-log'],
      [202, 'match-202-log'],
    ]));
  });

  it('logs fetch errors to PollLog without crashing', async () => {
    const fixtureMatches = [
      { matchId: 300, matchStatus: 'playing' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockFetchMatchStats.mockRejectedValue(new Error('Network timeout'));
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(result.matchDetails.size).toBe(0);
    expect(result.detailFetchErrors).toBe(1);
    expect(mockPollLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endpoint: 'match-detail',
          status: 'fetch_error',
          errorMessage: 'Network timeout',
        }),
      }),
    );
  });

  it('rethrows fixture fetch failures so worker readiness records an error', async () => {
    mockFetchFixture.mockRejectedValue(new Error('Fixture service unavailable'));
    mockPollLogCreate.mockResolvedValue({ id: 'fixture-error-log' } as any);

    await expect(ingestFromChampionData(12949)).rejects.toThrow('Fixture service unavailable');
    expect(mockPollLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        endpoint: 'fixture',
        status: 'fetch_error',
      }),
    }));
  });

  it('fetches match details for SCHEDULED matches that CD reports as complete (backfill)', async () => {
    const fixtureMatches = [
      { matchId: 400, matchStatus: 'complete' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([
      { championDataMatchId: 400, status: 'SCHEDULED', _count: { playerStats: 0 } },
    ] as any);
    const matchDetail = {
      matchInfo: { matchId: 400, period: 4, periodSeconds: 900 },
    };
    mockFetchMatchStats.mockResolvedValue(matchDetail as any);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(mockFetchMatchStats).toHaveBeenCalledWith(12949, 400);
    expect(result.matchDetails.get(400)).toEqual(matchDetail);
  });

  it('fetches completed details for a fixture that is not in the database yet', async () => {
    mockFetchFixture.mockResolvedValue([
      { matchId: 500, matchStatus: 'complete' },
    ] as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockFetchMatchStats.mockResolvedValue({ matchInfo: { matchId: 500 } } as any);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12950);

    expect(mockFetchMatchStats).toHaveBeenCalledWith(12950, 500);
    expect(result.matchDetails.has(500)).toBe(true);
  });

  it('repairs completed matches whose detail stats were never stored', async () => {
    mockFetchFixture.mockResolvedValue([
      { matchId: 600, matchStatus: 'complete' },
    ] as any);
    mockMatchFindMany.mockResolvedValue([
      { championDataMatchId: 600, status: 'COMPLETED', _count: { playerStats: 0 } },
    ] as any);
    mockFetchMatchStats.mockResolvedValue({ matchInfo: { matchId: 600 } } as any);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12950);

    expect(result.matchDetails.has(600)).toBe(true);
  });

  it('expires only terminal PollLog entries and retains unresolved correction intent', async () => {
    mockFetchFixture.mockResolvedValue([]);
    mockMatchFindMany.mockResolvedValue([]);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    await ingestFromChampionData(12949);

    expect(mockPollLogDeleteMany).toHaveBeenCalledWith({
      where: {
        polledAt: { lt: expect.any(Date) },
        status: {
          in: ['success', 'processed', 'superseded', 'validation_error'],
        },
      },
    });
    expect(mockPollLogDeleteMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: expect.arrayContaining(['pending', 'fetch_error', 'revision_mismatch']) },
      }),
    }));
  });

  it('orders overlapping detail observations by request start even when the older response finishes last', async () => {
    vi.useFakeTimers();
    try {
      const deferred = <T,>() => {
        let resolve!: (value: T | PromiseLike<T>) => void;
        const promise = new Promise<T>((fulfil) => { resolve = fulfil; });
        return { promise, resolve };
      };
      const firstStarted = deferred<void>();
      const secondStarted = deferred<void>();
      const firstResponse = deferred<Record<string, unknown>>();
      const secondResponse = deferred<Record<string, unknown>>();
      mockFetchFixture
        .mockResolvedValueOnce([{ matchId: 701, matchStatus: 'playing' }] as any)
        .mockResolvedValueOnce([{ matchId: 702, matchStatus: 'playing' }] as any);
      mockMatchFindMany.mockResolvedValue([]);
      mockPollLogCreate.mockImplementation((async ({ data }: any) => ({
        id: data.cdMatchId ? `detail-${data.cdMatchId}` : `fixture-${new Date(data.polledAt).toISOString()}`,
      })) as never);
      mockFetchMatchStats.mockImplementation(async (_competitionId, matchId) => {
        if (matchId === 701) {
          firstStarted.resolve(undefined);
          return firstResponse.promise as any;
        }
        secondStarted.resolve(undefined);
        return secondResponse.promise as any;
      });

      vi.setSystemTime(new Date('2026-07-25T09:00:01.000Z'));
      const olderRequest = ingestFromChampionData(12949);
      await firstStarted.promise;

      vi.setSystemTime(new Date('2026-07-25T09:00:02.000Z'));
      const newerRequest = ingestFromChampionData(12949);
      await secondStarted.promise;
      secondResponse.resolve({ matchInfo: { matchId: 702 } });
      await newerRequest;

      vi.setSystemTime(new Date('2026-07-25T09:00:03.000Z'));
      firstResponse.resolve({ matchInfo: { matchId: 701 } });
      await olderRequest;

      const detailLogs = mockPollLogCreate.mock.calls
        .map(([query]) => query.data)
        .filter((data) => data.endpoint === 'match-detail');
      const olderLog = detailLogs.find((data) => data.cdMatchId === 701);
      const newerLog = detailLogs.find((data) => data.cdMatchId === 702);
      expect(olderLog).toBeDefined();
      expect(new Date(olderLog!.polledAt as string | Date).toISOString())
        .toBe('2026-07-25T09:00:01.000Z');
      expect(newerLog).toBeDefined();
      expect(new Date(newerLog!.polledAt as string | Date).toISOString())
        .toBe('2026-07-25T09:00:02.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});
