import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  outerCompetitionFindUnique: vi.fn(),
  txCompetitionFindUnique: vi.fn(),
  matchFindMany: vi.fn(),
  standingDeleteMany: vi.fn(),
  standingUpsert: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    competition: { findUnique: mocks.outerCompetitionFindUnique },
    $transaction: mocks.transaction,
  },
  excludeSimData: { isSimulation: false },
}));

import {
  acquireStandingsSourceLock,
  recalculateStandings,
  rebuildStandingsInTransaction,
} from '@/lib/standings';
import { SERIALIZABLE_TRANSACTION_OPTIONS } from '@/lib/serializable-transaction';

const AVAILABLE = [{ capability: 'FINAL_SCORE', state: 'AVAILABLE' }];

function transactionClient() {
  return {
    $queryRaw: mocks.queryRaw,
    competition: { findUnique: mocks.txCompetitionFindUnique },
    match: { findMany: mocks.matchFindMany },
    standing: {
      deleteMany: mocks.standingDeleteMany,
      upsert: mocks.standingUpsert,
    },
  };
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    homeTeamId: 'team-a',
    awayTeamId: 'team-b',
    homeScore: 60,
    awayScore: 50,
    dataCoverage: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.outerCompetitionFindUnique.mockResolvedValue({ id: 'comp-1' });
  mocks.txCompetitionFindUnique.mockResolvedValue({
    id: 'comp-1',
    dataCoverage: AVAILABLE,
  });
  mocks.matchFindMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([]);
  mocks.standingDeleteMany.mockResolvedValue({ count: 0 });
  mocks.standingUpsert.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (operation) => operation(transactionClient()));
});

describe('recalculateStandings', () => {
  it('skips when the source competition is absent', async () => {
    mocks.outerCompetitionFindUnique.mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recalculateStandings();

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.matchFindMany).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('computes wins, draws, losses, percentages and rank in one transaction', async () => {
    mocks.matchFindMany.mockResolvedValue([
      result(),
      result({ homeTeamId: 'team-b', awayTeamId: 'team-a', homeScore: 55, awayScore: 55 }),
      result({ homeScore: 70, awayScore: 62 }),
    ]);

    await recalculateStandings();

    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      SERIALIZABLE_TRANSACTION_OPTIONS,
    );
    expect(mocks.standingDeleteMany).toHaveBeenCalledWith({
      where: { competitionId: 'comp-1' },
    });
    const writes = mocks.standingUpsert.mock.calls.map(([write]) => write);
    const teamA = writes.find((write) => write.where.competitionId_teamId.teamId === 'team-a');
    const teamB = writes.find((write) => write.where.competitionId_teamId.teamId === 'team-b');
    expect(teamA.update).toMatchObject({
      rank: 1,
      played: 3,
      wins: 2,
      draws: 1,
      losses: 0,
      points: 10,
      goalsFor: 185,
      goalsAgainst: 167,
      goalPercentage: 110.8,
    });
    expect(teamB.update).toMatchObject({
      rank: 2,
      played: 3,
      wins: 0,
      draws: 1,
      losses: 2,
      points: 2,
      goalsFor: 167,
      goalsAgainst: 185,
      goalPercentage: 90.3,
    });
  });

  it('excludes a match whose FINAL_SCORE capability is revoked', async () => {
    mocks.matchFindMany.mockResolvedValue([
      result({
        homeTeamId: 'hidden-home',
        awayTeamId: 'hidden-away',
        homeScore: 99,
        awayScore: 1,
        dataCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE' }],
      }),
      result(),
    ]);

    await recalculateStandings();

    const teamIds = mocks.standingUpsert.mock.calls.map(
      ([write]) => write.where.competitionId_teamId.teamId,
    );
    expect(teamIds).toEqual(['team-a', 'team-b']);
    expect(mocks.matchFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        dataCoverage: {
          where: { capability: 'FINAL_SCORE' },
          select: { capability: true, state: true },
        },
      }),
    }));
  });

  it('removes stale rows when edition-level final scores are unavailable', async () => {
    mocks.txCompetitionFindUnique.mockResolvedValue({
      id: 'comp-1',
      dataCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE' }],
    });
    mocks.matchFindMany.mockResolvedValue([result()]);

    await recalculateStandings();

    expect(mocks.standingDeleteMany).toHaveBeenCalledWith({
      where: { competitionId: 'comp-1' },
    });
    expect(mocks.standingUpsert).not.toHaveBeenCalled();
  });

  it('queries only eligible published, non-simulation regular results', async () => {
    await recalculateStandings();

    expect(mocks.matchFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        competitionId: 'comp-1',
        status: 'COMPLETED',
        resultQuality: { in: ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'] },
        finalCode: null,
        isSimulation: false,
        OR: [
          { stageId: null },
          { stage: { is: { isPublished: true } } },
        ],
      }),
    }));
  });

  it('acquires the durable competition lock before reading and replacing the ladder', async () => {
    mocks.matchFindMany.mockResolvedValue([result()]);

    await recalculateStandings();

    const lockOrder = mocks.queryRaw.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(mocks.txCompetitionFindUnique.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(mocks.matchFindMany.mock.invocationCallOrder[0]);
    expect(lockOrder).toBeLessThan(mocks.standingDeleteMany.mock.invocationCallOrder[0]);
  });

  it('uses the same advisory key for a contributing mutation and its rebuild', async () => {
    const tx = transactionClient();

    await acquireStandingsSourceLock(tx as never, 'comp-1');
    await rebuildStandingsInTransaction(tx as never, 'comp-1');

    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.queryRaw.mock.calls[0][1]).toBe('centrepass:standings:comp-1');
    expect(mocks.queryRaw.mock.calls[1][1]).toBe('centrepass:standings:comp-1');
  });

  it('retries the complete locked rebuild after a serialization conflict', async () => {
    mocks.transaction
      .mockImplementationOnce(async (operation) => {
        await operation(transactionClient());
        throw Object.assign(new Error('write conflict'), { code: 'P2034' });
      })
      .mockImplementationOnce(async (operation) => operation(transactionClient()));

    await recalculateStandings();

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.matchFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.standingDeleteMany).toHaveBeenCalledTimes(2);
  });
});
