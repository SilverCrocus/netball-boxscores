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

  it('fetches match details for SCHEDULED matches that CD reports as complete (backfill)', async () => {
    const fixtureMatches = [
      { matchId: 400, matchStatus: 'complete' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([
      { championDataMatchId: 400 },
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

  it('cleans up PollLog entries older than 7 days', async () => {
    mockFetchFixture.mockResolvedValue([]);
    mockMatchFindMany.mockResolvedValue([]);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    await ingestFromChampionData(12949);

    expect(mockPollLogDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          polledAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });
});
