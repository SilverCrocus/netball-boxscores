import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEdition } from '@/lib/analytics/repository';
import {
  getPlayerRankingSnapshot,
  getTeamPowerSnapshot,
} from '@/lib/rankings/service';
import { getRecordSnapshot } from '@/lib/records/service';

const mocks = vi.hoisted(() => ({
  cache: new Map<string, string>(),
  snapshotEpoch: vi.fn(),
  playerFacts: vi.fn(),
  comparisonPlayers: vi.fn(),
  teamPowerMatches: vi.fn(),
  editionTeams: vi.fn(),
  playerRecordFacts: vi.fn(),
  teamRecordFacts: vi.fn(),
  analyticsEntities: vi.fn(),
  editions: vi.fn(),
  finalsStageIds: vi.fn(),
  playerCalculator: vi.fn(),
  teamCalculator: vi.fn(),
  recordCalculator: vi.fn(),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (
    loader: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
  ) => async (...args: unknown[]) => {
    const key = JSON.stringify([keyParts, args]);
    const stored = mocks.cache.get(key);
    if (stored === undefined) {
      const result = await loader(...args);
      mocks.cache.set(key, JSON.stringify(result));
      return result;
    }
    return JSON.parse(stored);
  },
}));

vi.mock('@/lib/analytics/repository', () => ({
  readAnalyticsSnapshotEpoch: mocks.snapshotEpoch,
  readComparisonPlayers: mocks.comparisonPlayers,
  readTeamPowerMatches: mocks.teamPowerMatches,
  readEditionTeams: mocks.editionTeams,
  readAnalyticsPlayerFacts: mocks.playerRecordFacts,
  readAnalyticsTeamFacts: mocks.teamRecordFacts,
  readAnalyticsEntities: mocks.analyticsEntities,
  listAnalyticsEditions: mocks.editions,
  readFinalsStageIds: mocks.finalsStageIds,
}));

vi.mock('@/lib/player-analytics', () => ({
  getCompetitionPlayerFacts: mocks.playerFacts,
}));

vi.mock('@/lib/rankings/player-rankings', () => ({
  calculatePlayerRankingSnapshot: mocks.playerCalculator,
}));

vi.mock('@/lib/rankings/team-power', () => ({
  calculateTeamPowerSnapshot: mocks.teamCalculator,
}));

vi.mock('@/lib/records/calculate', () => ({
  calculateRecordSnapshot: mocks.recordCalculator,
}));

const edition = (overrides: Partial<AnalyticsEdition> = {}): AnalyticsEdition => ({
  id: 'edition-1',
  season: 2026,
  name: 'Super Netball',
  slug: 'ssn-2026',
  label: '2026',
  seasonStart: new Date('2026-03-01T00:00:00.000Z'),
  seasonEnd: null,
  sourceTimezone: 'Australia/Sydney',
  series: {
    id: 'series-1',
    slug: 'ssn',
    name: 'Super Netball',
    kind: 'LEAGUE',
  },
  ...overrides,
});

const playerRequest = (overrides: Record<string, unknown> = {}) => ({
  competitionId: 'edition-1',
  metricId: 'goals',
  aggregation: 'TOTAL' as const,
  minimumMinutes: 120,
  from: new Date('2026-03-01T00:00:00.000Z'),
  to: new Date('2026-06-30T00:00:00.000Z'),
  ...overrides,
});

const recordQuery = (overrides: Record<string, unknown> = {}) => ({
  scope: 'EDITION' as const,
  metricId: 'goals',
  aggregation: 'TOTAL' as const,
  entityType: 'PLAYER' as const,
  competitionId: 'edition-1',
  limit: 25,
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('analytics snapshot cache safety', () => {
  beforeEach(() => {
    mocks.cache.clear();
    for (const mock of [
      mocks.snapshotEpoch,
      mocks.playerFacts,
      mocks.comparisonPlayers,
      mocks.teamPowerMatches,
      mocks.editionTeams,
      mocks.playerRecordFacts,
      mocks.teamRecordFacts,
      mocks.analyticsEntities,
      mocks.editions,
      mocks.finalsStageIds,
      mocks.playerCalculator,
      mocks.teamCalculator,
      mocks.recordCalculator,
    ]) mock.mockReset();

    mocks.snapshotEpoch.mockResolvedValue({
      revision: BigInt(1),
      invalidatedAt: new Date('2026-07-22T00:00:00.000Z'),
      contractVersion: 'analytics-cache-epoch.v1',
    });
    mocks.playerFacts.mockResolvedValue([{ entityId: 'player-1' }]);
    mocks.comparisonPlayers.mockResolvedValue([{
      id: 'player-1',
      name: 'Player One',
      position: 'GS',
      teamName: 'Team One',
    }]);
    mocks.teamPowerMatches.mockResolvedValue([]);
    mocks.editionTeams.mockResolvedValue([]);
    mocks.playerRecordFacts.mockResolvedValue([]);
    mocks.teamRecordFacts.mockResolvedValue([]);
    mocks.analyticsEntities.mockResolvedValue([]);
    mocks.editions.mockResolvedValue([edition()]);
    mocks.finalsStageIds.mockResolvedValue([]);
    mocks.playerCalculator.mockImplementation((facts: unknown[], _entities: unknown[], request: unknown) => ({
      rankingType: 'PLAYER_METRIC',
      methodVersion: 'centrepass-player-ranking.v1',
      formulaVersion: 'goals.v1',
      scopeKey: 'test-scope',
      request,
      asOf: '2026-07-22T00:00:00.000Z',
      populationSize: facts.length,
      entries: [],
    }));
    mocks.teamCalculator.mockImplementation((competitionId: string) => ({
      rankingType: 'TEAM_POWER',
      methodVersion: 'centrepass-team-power.v1',
      formulaVersion: 'centrepass-team-power.v1',
      competitionId,
      competitionSeriesId: null,
      competitionKind: null,
      scopeKey: `edition:${competitionId}`,
      asOf: null,
      populationSize: 0,
      entries: [],
    }));
    mocks.recordCalculator.mockImplementation((_facts: unknown[], _entities: unknown[], request: unknown) => ({
      methodVersion: 'centrepass-records.v1',
      request,
      asOf: '2026-07-22T00:00:00.000Z',
      coverageLabel: 'test coverage',
      entries: [],
    }));
  });

  it('hits an identical player-ranking calculation and avoids heavy reads', async () => {
    const request = playerRequest();
    const cold = await getPlayerRankingSnapshot(request);
    const warm = await getPlayerRankingSnapshot(request);

    expect(warm).toEqual(cold);
    expect(cold.request.from).toBeInstanceOf(Date);
    expect(cold.request.to).toBeInstanceOf(Date);
    expect(warm.request.from).toBeInstanceOf(Date);
    expect(warm.request.to).toBeInstanceOf(Date);
    expect(mocks.snapshotEpoch).toHaveBeenCalledTimes(2);
    expect(mocks.playerFacts).toHaveBeenCalledTimes(1);
    expect(mocks.comparisonPlayers).toHaveBeenCalledTimes(1);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(1);
  });

  it('preserves nested ranking MetricResult window dates across cold and warm hits', async () => {
    const windowFrom = new Date('2026-04-01T00:00:00.000Z');
    const windowTo = new Date('2026-06-30T00:00:00.000Z');
    mocks.playerCalculator.mockImplementation((facts: unknown[], _entities: unknown[], request: unknown) => ({
      rankingType: 'PLAYER_METRIC',
      methodVersion: 'centrepass-player-ranking.v1',
      formulaVersion: 'goals.v1',
      scopeKey: 'test-scope',
      request,
      asOf: '2026-07-22T00:00:00.000Z',
      populationSize: facts.length,
      entries: [{
        rank: 1,
        percentile: 99,
        entity: {
          id: 'player-1',
          name: 'Player One',
          position: 'GS',
          teamName: 'Team One',
        },
        result: {
          metricId: 'goals',
          value: 42,
          status: 'AVAILABLE',
          unit: 'COUNT',
          aggregation: 'TOTAL',
          context: {
            entityType: 'PLAYER',
            entityId: 'player-1',
            competitionId: 'edition-1',
            window: { from: windowFrom, to: windowTo },
          },
          games: 4,
          minutes: 240,
          minimumSample: { minutes: 120 },
          minimumSampleMet: true,
          coverage: 'AVAILABLE',
          formulaVersion: 'goals.v1',
          asOf: '2026-07-22T00:00:00.000Z',
          includedMatchIds: ['match-1'],
        },
        movement: null,
        movementLabel: 'NEW',
      }],
    }));

    const request = playerRequest();
    const cold = await getPlayerRankingSnapshot(request);
    const warm = await getPlayerRankingSnapshot(request);
    const coldWindow = cold.entries[0]?.result.context.window;
    const warmWindow = warm.entries[0]?.result.context.window;

    expect(warm).toEqual(cold);
    expect(cold.request.from).toBeInstanceOf(Date);
    expect(cold.request.to).toBeInstanceOf(Date);
    expect(warm.request.from).toBeInstanceOf(Date);
    expect(warm.request.to).toBeInstanceOf(Date);
    expect(coldWindow?.from).toBeInstanceOf(Date);
    expect(coldWindow?.to).toBeInstanceOf(Date);
    expect(warmWindow?.from).toBeInstanceOf(Date);
    expect(warmWindow?.to).toBeInstanceOf(Date);
  });

  it('does not collide changed request fields and does not serve an old epoch result', async () => {
    await getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 120 }));
    await getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 121 }));
    expect(mocks.playerFacts).toHaveBeenCalledTimes(2);

    mocks.snapshotEpoch.mockResolvedValue({
      revision: BigInt(2),
      invalidatedAt: new Date('2026-07-22T00:01:00.000Z'),
      contractVersion: 'analytics-cache-epoch.v1',
    });
    await getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 120 }));
    expect(mocks.playerFacts).toHaveBeenCalledTimes(3);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(3);
  });

  it('coalesces identical parallel ranking misses while keeping distinct keys separate', async () => {
    const firstFacts = deferred<unknown[]>();
    const secondFacts = deferred<unknown[]>();
    let factCall = 0;
    mocks.playerFacts.mockImplementation(async () => {
      factCall += 1;
      await (factCall === 1 ? firstFacts.promise : secondFacts.promise);
      return [{ entityId: 'player-1' }];
    });

    const sameA = getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 120 }));
    const sameB = getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 120 }));
    await vi.waitFor(() => expect(mocks.playerFacts).toHaveBeenCalledTimes(1));
    firstFacts.resolve([]);
    await Promise.all([sameA, sameB]);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(1);

    const distinctA = getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 121 }));
    const distinctB = getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 122 }));
    await vi.waitFor(() => expect(mocks.playerFacts).toHaveBeenCalledTimes(3));
    secondFacts.resolve([]);
    await Promise.all([distinctA, distinctB]);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(3);
  });

  it('cleans up a rejected ranking flight so the next call retries', async () => {
    mocks.playerFacts
      .mockRejectedValueOnce(new Error('temporary facts failure'))
      .mockResolvedValue([{ entityId: 'player-1' }]);

    await expect(getPlayerRankingSnapshot(playerRequest())).rejects.toThrow('temporary facts failure');
    await getPlayerRankingSnapshot(playerRequest());

    expect(mocks.playerFacts).toHaveBeenCalledTimes(2);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(1);
  });

  it('returns an oversized computed DTO without persisting or recomputing it', async () => {
    const facts = Array.from({ length: 2_500 }, (_, index) => ({ entityId: `player-${index}` }));
    const players = facts.map((fact, index) => ({
      id: fact.entityId,
      name: `Player ${index} ${'x'.repeat(700)}`,
      position: 'GS',
      teamName: 'Team One',
    }));
    mocks.playerFacts.mockResolvedValue(facts);
    mocks.comparisonPlayers.mockResolvedValue(players);
    mocks.playerCalculator.mockImplementation((inputFacts: unknown[], _entities: unknown[], request: unknown) => ({
      rankingType: 'PLAYER_METRIC',
      methodVersion: 'centrepass-player-ranking.v1',
      formulaVersion: 'goals.v1',
      scopeKey: 'oversized-test',
      request,
      asOf: '2026-07-22T00:00:00.000Z',
      populationSize: inputFacts.length,
      entries: inputFacts.map((fact, index) => ({
        rank: index + 1,
        percentile: 50,
        entity: players[index],
        result: {
          metricId: 'goals',
          value: 42,
          status: 'AVAILABLE',
          unit: 'COUNT',
          aggregation: 'TOTAL',
          context: {
            entityType: 'PLAYER',
            entityId: (fact as { entityId: string }).entityId,
            competitionId: 'edition-1',
          },
          games: 4,
          minutes: 240,
          minimumSample: { minutes: 120 },
          minimumSampleMet: true,
          coverage: 'AVAILABLE',
          formulaVersion: 'goals.v1',
          asOf: '2026-07-22T00:00:00.000Z',
          includedMatchIds: ['match-1'],
        },
        movement: null,
        movementLabel: 'NEW',
      })),
    }));

    const result = await getPlayerRankingSnapshot(playerRequest());

    expect(result.entries).toHaveLength(2_500);
    expect(mocks.playerFacts).toHaveBeenCalledTimes(1);
    expect(mocks.comparisonPlayers).toHaveBeenCalledTimes(1);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(1);
    expect(mocks.cache.size).toBe(0);
  });

  it('does not share a ranking flight across epoch rotation', async () => {
    let revision = 1;
    mocks.snapshotEpoch.mockImplementation(async () => ({
      revision: BigInt(revision),
      invalidatedAt: new Date('2026-07-22T00:00:00.000Z'),
      contractVersion: 'analytics-cache-epoch.v1',
    }));
    const firstFacts = deferred<unknown[]>();
    const secondFacts = deferred<unknown[]>();
    let factCall = 0;
    mocks.playerFacts.mockImplementation(async () => {
      factCall += 1;
      await (factCall === 1 ? firstFacts.promise : secondFacts.promise);
      return [{ entityId: 'player-1' }];
    });
    let calculation = 0;
    mocks.playerCalculator.mockImplementation((facts: unknown[], _entities: unknown[], request: unknown) => ({
      rankingType: 'PLAYER_METRIC',
      methodVersion: 'centrepass-player-ranking.v1',
      formulaVersion: 'goals.v1',
      scopeKey: `calculation-${++calculation}`,
      request,
      asOf: '2026-07-22T00:00:00.000Z',
      populationSize: facts.length,
      entries: [],
    }));

    const first = getPlayerRankingSnapshot(playerRequest());
    await vi.waitFor(() => expect(mocks.playerFacts).toHaveBeenCalledTimes(1));
    revision = 2;
    const second = getPlayerRankingSnapshot(playerRequest());
    await vi.waitFor(() => expect(mocks.playerFacts).toHaveBeenCalledTimes(2));
    firstFacts.resolve([]);
    secondFacts.resolve([]);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.scopeKey).not.toBe(secondResult.scopeKey);
    expect(mocks.cache.size).toBe(2);
  });

  it('bypasses the player cache when the epoch read fails', async () => {
    mocks.snapshotEpoch.mockRejectedValue(new Error('epoch unavailable'));
    await getPlayerRankingSnapshot(playerRequest());
    await getPlayerRankingSnapshot(playerRequest());

    expect(mocks.playerFacts).toHaveBeenCalledTimes(2);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(2);
    expect(mocks.cache.size).toBe(0);
  });

  it('rejects a positive legacy revision and never reuses a result without the v1 discriminator', async () => {
    mocks.snapshotEpoch.mockResolvedValue({
      revision: BigInt(99),
      invalidatedAt: new Date('2026-07-22T00:00:00.000Z'),
      contractVersion: 'legacy-cache-revision',
    });

    await getPlayerRankingSnapshot(playerRequest());
    await getPlayerRankingSnapshot(playerRequest());

    expect(mocks.playerFacts).toHaveBeenCalledTimes(2);
    expect(mocks.playerCalculator).toHaveBeenCalledTimes(2);
    expect(mocks.cache.size).toBe(0);
  });

  it('bypasses caching for zero or malformed authenticated epochs', async () => {
    mocks.snapshotEpoch.mockResolvedValue({
      revision: BigInt(0),
      invalidatedAt: null,
      contractVersion: 'analytics-cache-epoch.v1',
    });
    await getPlayerRankingSnapshot(playerRequest());
    await getPlayerRankingSnapshot(playerRequest());

    mocks.snapshotEpoch.mockResolvedValue({
      revision: 'not-a-bigint' as unknown as bigint,
      invalidatedAt: null,
      contractVersion: 'analytics-cache-epoch.v1',
    });
    await getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 121 }));
    await getPlayerRankingSnapshot(playerRequest({ minimumMinutes: 121 }));

    expect(mocks.playerCalculator).toHaveBeenCalledTimes(4);
    expect(mocks.cache.size).toBe(0);
  });

  it('caches team power by epoch, competition, and method contract', async () => {
    await getTeamPowerSnapshot('edition-1');
    await getTeamPowerSnapshot('edition-1');
    await getTeamPowerSnapshot('edition-2');

    expect(mocks.teamPowerMatches).toHaveBeenCalledTimes(2);
    expect(mocks.editionTeams).toHaveBeenCalledTimes(2);
    expect(mocks.teamCalculator).toHaveBeenCalledTimes(2);
  });

  it('caches Records with ordered edition identity and bypasses after an epoch failure', async () => {
    const context = { editions: [edition()] };
    const cold = await getRecordSnapshot(recordQuery(), context);
    const warm = await getRecordSnapshot(recordQuery(), context);
    expect(warm).toEqual(cold);
    expect(cold.request.coverageStart).toBeInstanceOf(Date);
    expect(warm.request.coverageStart).toBeInstanceOf(Date);
    expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(1);
    expect(mocks.analyticsEntities).toHaveBeenCalledTimes(1);
    expect(mocks.recordCalculator).toHaveBeenCalledTimes(1);

    await getRecordSnapshot(recordQuery(), { editions: [edition({ label: 'Published correction' })] });
    expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(2);

    mocks.snapshotEpoch.mockRejectedValue(new Error('epoch unavailable'));
    await getRecordSnapshot(recordQuery(), context);
    await getRecordSnapshot(recordQuery(), context);
    expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(4);
    expect(mocks.recordCalculator).toHaveBeenCalledTimes(4);
  });

  it('coalesces identical parallel Records misses and cleans up after rejection', async () => {
    const factsGate = deferred<unknown[]>();
    mocks.playerRecordFacts.mockImplementation(async () => {
      await factsGate.promise;
      return [];
    });
    const context = { editions: [edition()] };
    const first = getRecordSnapshot(recordQuery(), context);
    const second = getRecordSnapshot(recordQuery(), context);
    await vi.waitFor(() => expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(1));
    factsGate.resolve([]);
    await Promise.all([first, second]);
    expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(1);
    expect(mocks.recordCalculator).toHaveBeenCalledTimes(1);

    mocks.playerRecordFacts
      .mockRejectedValueOnce(new Error('temporary record facts failure'))
      .mockResolvedValue([]);
    await expect(getRecordSnapshot(recordQuery({ limit: 26 }), context)).rejects.toThrow('temporary record facts failure');
    await getRecordSnapshot(recordQuery({ limit: 26 }), context);
    expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(3);
  });

  it('does not collide a changed Records limit', async () => {
    const context = { editions: [edition()] };
    await getRecordSnapshot(recordQuery({ limit: 25 }), context);
    await getRecordSnapshot(recordQuery({ limit: 50 }), context);

    expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(2);
    expect(mocks.recordCalculator).toHaveBeenCalledTimes(2);
  });

  it('rehydrates JSON-safe cached edition dates before calculating Records without context', async () => {
    const cold = await getRecordSnapshot(recordQuery());
    const warm = await getRecordSnapshot(recordQuery());

    expect(warm).toEqual(cold);
    expect(cold.request.coverageStart).toBeInstanceOf(Date);
    expect(warm.request.coverageStart).toBeInstanceOf(Date);
    expect(mocks.editions).toHaveBeenCalledTimes(1);
    expect(mocks.playerRecordFacts).toHaveBeenCalledTimes(1);
  });

  it('preserves an omitted Records limit through the cached calculation contract', async () => {
    const context = { editions: [edition()] };
    const result = await getRecordSnapshot(recordQuery({ limit: undefined }), context);

    expect(result.request.limit).toBeUndefined();
  });
});
