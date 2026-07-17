import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { planCompetitionImport } from '@/lib/sources/planner';
import {
  PrismaCompetitionImportWriter,
  recordPrismaImportPreview,
} from '@/lib/sources/prisma-writer';
import { validImport } from '@/lib/sources/__tests__/fixtures';
import type { NormalizedCompetitionImport } from '@/lib/sources/types';

function createFakePrisma(
  publicationStatus: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED',
  options: {
    reverseBulkReturns?: boolean;
    sourceKey?: string;
    editionExternalId?: string;
    beforeCompetitionLock?: (state: { publicationStatus: 'DRAFT' | 'PUBLISHED' }) => void;
  } = {},
) {
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${++sequence}`;
  const state = {
    runs: new Map<string, Record<string, unknown>>(),
    teams: new Map<string, Record<string, unknown>>(),
    entries: new Map<string, Record<string, unknown>>(),
    players: new Map<string, Record<string, unknown>>(),
    rosters: new Map<string, Record<string, unknown>>(),
    matches: new Map<string, Record<string, unknown>>(),
    slots: new Map<string, Record<string, unknown>>(),
    quarters: new Map<string, Record<string, unknown>>(),
    mappings: new Map<string, Record<string, unknown>>(),
    coverage: new Map<string, Record<string, unknown>>(),
    mutations: [] as Record<string, unknown>[],
    snapshots: new Map<string, Record<string, unknown>>(),
    competition: { id: 'edition-id', publicationStatus },
    editionSource: {
      id: 'edition-source-id',
      competitionId: 'edition-id',
      sourceSystemId: 'source-id',
      externalId: options.editionExternalId ?? 'test-2026',
      lastSyncedAt: null,
    } as Record<string, unknown>,
  };
  const create = (map: Map<string, Record<string, unknown>>, prefix: string) =>
    vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: data.id ?? nextId(prefix), ...data };
      map.set(String(row.id), row);
      return row;
    });
  const createManyAndReturn = (
    map: Map<string, Record<string, unknown>>,
    prefix: string,
  ) => vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
    const rows = data.map((item) => {
      const row = { id: item.id ?? nextId(prefix), ...item };
      map.set(String(row.id), row);
      return row;
    });
    return options.reverseBulkReturns ? rows.reverse() : rows;
  });
  const update = (map: Map<string, Record<string, unknown>>) =>
    vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...map.get(where.id), ...data, id: where.id };
      map.set(where.id, row);
      return row;
    });

  const tx = {
    $queryRaw: vi.fn(async () => {
      options.beforeCompetitionLock?.(state.competition);
      return [{ ...state.competition }];
    }),
    sourceSystem: {
      findUnique: vi.fn(async () => ({
        id: 'source-id',
        key: options.sourceKey ?? 'manual',
        rawPayloadStorageAllowed: true,
      })),
    },
    editionSource: {
      findUnique: vi.fn(async () => ({ ...state.editionSource })),
      update: vi.fn(async ({ where, data }) => {
        state.editionSource = { ...state.editionSource, ...data, id: where.id };
        return { ...state.editionSource };
      }),
    },
    importRun: {
      findMany: vi.fn(async ({ where, take }) =>
        [...state.runs.values()].filter((run) =>
          run.sourceSystemId === where.sourceSystemId &&
          run.competitionId === where.competitionId &&
          run.checksum === where.checksum &&
          run.status === where.status &&
          (where.dryRun === undefined || run.dryRun === where.dryRun) &&
          (where.issueCount === undefined || run.issueCount === where.issueCount)
        ).reverse().slice(0, take)),
      findFirst: vi.fn(async ({ where }) =>
        [...state.runs.values()].find((run) =>
          run.sourceSystemId === where.sourceSystemId &&
          run.competitionId === where.competitionId &&
          run.checksum === where.checksum &&
          run.status === where.status &&
          (where.dryRun === undefined || run.dryRun === where.dryRun) &&
          (where.issueCount === undefined || run.issueCount === where.issueCount)
        ) ?? null),
      create: create(state.runs, 'run'),
      update: update(state.runs),
    },
    importIssue: { createMany: vi.fn(async () => ({ count: 0 })) },
    importMutation: {
      create: vi.fn(async ({ data }) => {
        const row = { id: nextId('mutation'), ...data };
        state.mutations.push(row);
        return row;
      }),
      createMany: vi.fn(async ({ data }) => {
        for (const item of data) {
          state.mutations.push({ id: nextId('mutation'), ...item });
        }
        return { count: data.length };
      }),
    },
    stage: {
      findMany: vi.fn(async () => [
        { id: 'stage-pool', slug: 'pool-stage' },
        { id: 'stage-classification', slug: 'classification' },
        { id: 'stage-semi-finals', slug: 'semi-finals' },
        { id: 'stage-medal-matches', slug: 'medal-matches' },
      ]),
    },
    stageGroup: {
      findMany: vi.fn(async () => [
        {
          id: 'group-a',
          slug: 'pool-a',
          stageId: 'stage-pool',
          stage: { slug: 'pool-stage' },
        },
        {
          id: 'group-b',
          slug: 'pool-b',
          stageId: 'stage-pool',
          stage: { slug: 'pool-stage' },
        },
      ]),
    },
    sourceEntityMapping: {
      findMany: vi.fn(async () => [...state.mappings.values()]),
      create: create(state.mappings, 'mapping'),
      createManyAndReturn: createManyAndReturn(state.mappings, 'mapping'),
      update: update(state.mappings),
    },
    team: {
      findMany: vi.fn(async () => [...state.teams.values()]),
      findFirst: vi.fn(async ({ where }) =>
        [...state.teams.values()].find((team) =>
          team.competitionId === where.competitionId && team.slug === where.slug
        ) ?? null),
      findUnique: vi.fn(async ({ where }) => {
        if (where.id) return state.teams.get(where.id) ?? null;
        if (where.slug) return [...state.teams.values()].find((team) => team.slug === where.slug) ?? null;
        return null;
      }),
      create: create(state.teams, 'team'),
      createManyAndReturn: createManyAndReturn(state.teams, 'team'),
      update: update(state.teams),
    },
    editionEntry: {
      findMany: vi.fn(async () => [...state.entries.values()]),
      findUnique: vi.fn(async ({ where }) => {
        const key = where.competitionId_teamId;
        return [...state.entries.values()].find((entry) =>
          entry.competitionId === key.competitionId && entry.teamId === key.teamId
        ) ?? null;
      }),
      create: create(state.entries, 'entry'),
      createManyAndReturn: createManyAndReturn(state.entries, 'entry'),
      update: update(state.entries),
    },
    player: {
      findMany: vi.fn(async () => [...state.players.values()]),
      findUnique: vi.fn(async ({ where }) => {
        if (where.id) return state.players.get(where.id) ?? null;
        if (where.championDataPlayerId) {
          return [...state.players.values()].find((player) =>
            player.championDataPlayerId === where.championDataPlayerId
          ) ?? null;
        }
        return null;
      }),
      create: create(state.players, 'player'),
      createManyAndReturn: createManyAndReturn(state.players, 'player'),
      update: update(state.players),
    },
    rosterMembership: {
      findMany: vi.fn(async () => [...state.rosters.values()].filter((roster) =>
        roster.validTo == null
      )),
      findFirst: vi.fn(async ({ where }) =>
        [...state.rosters.values()].find((roster) =>
          roster.editionEntryId === where.editionEntryId &&
          roster.playerId === where.playerId &&
          roster.validTo == null
        ) ?? null),
      create: create(state.rosters, 'roster'),
      createManyAndReturn: createManyAndReturn(state.rosters, 'roster'),
      update: update(state.rosters),
    },
    match: {
      findMany: vi.fn(async () => [...state.matches.values()]),
      findUnique: vi.fn(async ({ where }) => state.matches.get(where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }) => {
        const row = state.matches.get(where.id);
        if (!row) throw new Error('missing match');
        return row;
      }),
      create: create(state.matches, 'match'),
      createManyAndReturn: createManyAndReturn(state.matches, 'match'),
      update: update(state.matches),
    },
    matchSlot: {
      findMany: vi.fn(async () => [...state.slots.values()]),
      findUnique: vi.fn(async ({ where }) => {
        const key = where.matchId_side;
        return [...state.slots.values()].find((slot) =>
          slot.matchId === key.matchId && slot.side === key.side
        ) ?? null;
      }),
      create: create(state.slots, 'slot'),
      createManyAndReturn: createManyAndReturn(state.slots, 'slot'),
      update: update(state.slots),
    },
    matchQuarter: {
      findMany: vi.fn(async () => [...state.quarters.values()]),
      findUnique: vi.fn(async ({ where }) => {
        const key = where.matchId_quarter;
        return [...state.quarters.values()].find((quarter) =>
          quarter.matchId === key.matchId && quarter.quarter === key.quarter
        ) ?? null;
      }),
      create: create(state.quarters, 'quarter'),
      createManyAndReturn: createManyAndReturn(state.quarters, 'quarter'),
      update: update(state.quarters),
    },
    dataCoverage: {
      findMany: vi.fn(async () => [...state.coverage.values()]),
      findFirst: vi.fn(async ({ where }) =>
        [...state.coverage.values()].find((coverage) =>
          coverage.competitionId === where.competitionId &&
          coverage.matchId === where.matchId &&
          coverage.capability === where.capability
        ) ?? null),
      create: create(state.coverage, 'coverage'),
      createManyAndReturn: createManyAndReturn(state.coverage, 'coverage'),
      update: update(state.coverage),
    },
    sourceSnapshot: {
      findUnique: vi.fn(async ({ where }) =>
        [...state.snapshots.values()].find((snapshot) => snapshot.dedupeKey === where.dedupeKey) ?? null),
      create: create(state.snapshots, 'snapshot'),
    },
  };
  const rollbackState = () => {
    const mapKeys = [
      'runs',
      'teams',
      'entries',
      'players',
      'rosters',
      'matches',
      'slots',
      'quarters',
      'mappings',
      'coverage',
      'snapshots',
    ] as const;
    const maps = Object.fromEntries(
      mapKeys.map((key) => [key, new Map(state[key])]),
    ) as Record<(typeof mapKeys)[number], Map<string, Record<string, unknown>>>;
    const mutations = state.mutations.map((mutation) => ({ ...mutation }));
    const editionSource = { ...state.editionSource };
    const competition = { ...state.competition };
    const sequenceBefore = sequence;
    return () => {
      for (const key of mapKeys) {
        state[key].clear();
        for (const [id, row] of maps[key]) state[key].set(id, row);
      }
      state.mutations.splice(0, state.mutations.length, ...mutations);
      state.editionSource = editionSource;
      state.competition = competition;
      sequence = sequenceBefore;
    };
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => {
      const restore = rollbackState();
      try {
        return await callback(tx);
      } catch (error) {
        restore();
        throw error;
      }
    }),
    importRun: tx.importRun,
  } as unknown as PrismaClient;
  return { prisma, state, tx };
}

function transactionStatementCount(tx: Record<string, unknown>): number {
  return Object.values(tx).reduce<number>((total, delegate) => {
    if (!delegate || typeof delegate !== 'object') return total;
    return total + Object.values(delegate).reduce<number>((delegateTotal, method) => {
      if (typeof method !== 'function' || !('_isMockFunction' in method)) return delegateTotal;
      return delegateTotal + (method as ReturnType<typeof vi.fn>).mock.calls.length;
    }, 0);
  }, 0);
}

function importedIdentities(mappings: Map<string, Record<string, unknown>>) {
  return [...mappings.values()].map((mapping) => ({
    entityType: mapping.entityType as 'TEAM' | 'PLAYER' | 'MATCH',
    externalId: String(mapping.externalId),
    internalEntityId: String(mapping.internalEntityId),
  }));
}

describe('PrismaCompetitionImportWriter', () => {
  it('defensively rejects duplicate bulk identities before opening a transaction', async () => {
    const input = validImport();
    input.rosters.push(structuredClone(input.rosters[0]));
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const spoofedPreview = { ...preview, valid: true };
    const { prisma } = createFakePrisma();
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });

    await expect(writer.execute(input, spoofedPreview)).rejects.toThrow(
      'DUPLICATE_ROSTER_IDENTITY',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('persists the validated canonical bundle and skips an exact replay', async () => {
    const input = validImport();
    input.teams[0].groupSlug = 'pool-a';
    input.matches[0].groupSlug = 'pool-a';
    input.results[0].periods = [
      { period: 1, sideAScore: 15, sideBScore: 12 },
    ];
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      knownGroupSlugs: ['pool-a'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    expect(preview.valid).toBe(true);

    const { prisma, state, tx } = createFakePrisma('PUBLISHED', {
      reverseBulkReturns: true,
    });
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });
    const first = await writer.execute(input, preview);

    expect(first.inserted).toBeGreaterThan(0);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 10_000,
      timeout: 120_000,
    });
    expect(first.publicationStatus).toBe('PUBLISHED');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.sourceSystem.findUnique.mock.invocationCallOrder[0],
    );
    expect(transactionStatementCount(tx)).toBeLessThanOrEqual(50);
    expect(tx.team.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.editionEntry.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.player.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.rosterMembership.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.match.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.matchSlot.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.matchQuarter.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.dataCoverage.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.sourceEntityMapping.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.importMutation.create).not.toHaveBeenCalled();
    expect(tx.importMutation.createMany).toHaveBeenCalledTimes(1);
    expect(tx.team.create).not.toHaveBeenCalled();
    expect(tx.player.create).not.toHaveBeenCalled();
    expect(tx.match.create).not.toHaveBeenCalled();
    expect(tx.player.findUnique).not.toHaveBeenCalled();
    expect(tx.rosterMembership.findFirst).not.toHaveBeenCalled();
    expect(tx.matchSlot.findUnique).not.toHaveBeenCalled();
    expect(tx.matchQuarter.findUnique).not.toHaveBeenCalled();
    expect(tx.dataCoverage.findFirst).not.toHaveBeenCalled();
    expect(state.teams).toHaveLength(2);
    expect(state.entries).toHaveLength(2);
    expect(state.players).toHaveLength(1);
    expect(state.rosters).toHaveLength(1);
    expect(state.matches).toHaveLength(1);
    expect(state.slots).toHaveLength(2);
    expect(state.quarters).toHaveLength(1);
    expect(state.coverage).toHaveLength(10);
    expect([...state.players.values()][0]).toMatchObject({
      photoUrl: 'https://cdn.example.test/player.jpg',
      photoSourceUrl: 'https://example.test/media/player',
      photoCredit: 'Example Photographer',
      photoLicense: 'CC BY 4.0',
    });
    expect(state.mutations.map((mutation) => mutation.target)).toEqual(expect.arrayContaining([
      'TEAM',
      'EDITION_ENTRY',
      'PLAYER',
      'ROSTER_MEMBERSHIP',
      'MATCH',
      'MATCH_SLOT',
      'MATCH_QUARTER',
      'DATA_COVERAGE',
      'SOURCE_ENTITY_MAPPING',
      'SOURCE_SNAPSHOT',
      'EDITION_SOURCE',
    ]));
    expect(state.mutations.map((mutation) => mutation.sequence)).toEqual(
      state.mutations.map((_, index) => index + 1),
    );
    expect(first.inserted).toBe(
      state.mutations.filter((mutation) => mutation.operation === 'INSERT').length,
    );
    expect(first.updated).toBe(
      state.mutations.filter((mutation) => mutation.operation === 'UPDATE').length,
    );
    expect(first.inserted + first.updated + first.skipped).toBe(26);
    const firstRun = [...state.runs.values()].find((run) => run.id === first.importRunId);
    expect(firstRun).toMatchObject({
      insertedCount: first.inserted,
      updatedCount: first.updated,
    });
    expect(firstRun?.startedAt).toBeInstanceOf(Date);
    expect(firstRun?.completedAt).toBeInstanceOf(Date);
    expect((firstRun?.completedAt as Date).getTime()).toBeGreaterThanOrEqual(
      (firstRun?.startedAt as Date).getTime(),
    );

    const second = await writer.execute(input, preview);
    expect(second).toMatchObject({
      inserted: 0,
      updated: 0,
      skipped: first.inserted + first.updated + first.skipped,
      publicationStatus: 'PUBLISHED',
    });
    expect(state.teams).toHaveLength(2);
    expect(state.matches).toHaveLength(1);
  });

  it('reconciles a legacy same-checksum run before allowing a provenance-matched replay', async () => {
    const input = validImport();
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    expect(preview.valid).toBe(true);

    const { prisma, state, tx } = createFakePrisma();
    const legacyWriter = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });
    await legacyWriter.execute(input, preview);
    const firstMutationCount = state.mutations.length;
    const statementsBeforeReconciliation = transactionStatementCount(tx);
    const entityUpdatesBeforeReconciliation = [
      tx.team.update,
      tx.editionEntry.update,
      tx.player.update,
      tx.rosterMembership.update,
      tx.match.update,
      tx.matchSlot.update,
      tx.matchQuarter.update,
      tx.dataCoverage.update,
      tx.sourceEntityMapping.update,
    ].reduce((count, method) => count + method.mock.calls.length, 0);

    const currentWriter = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      receiptMetadata: { importKind: 'GLASGOW_FOUNDATION' },
    });
    const reconciled = await currentWriter.execute(input, preview);
    expect(reconciled).toMatchObject({
      inserted: 0,
      updated: 0,
      publicationStatus: 'PUBLISHED',
    });
    expect(reconciled.skipped).toBeGreaterThan(0);
    expect(state.mutations).toHaveLength(firstMutationCount);
    expect(transactionStatementCount(tx) - statementsBeforeReconciliation).toBeLessThanOrEqual(25);
    const entityUpdatesAfterReconciliation = [
      tx.team.update,
      tx.editionEntry.update,
      tx.player.update,
      tx.rosterMembership.update,
      tx.match.update,
      tx.matchSlot.update,
      tx.matchQuarter.update,
      tx.dataCoverage.update,
      tx.sourceEntityMapping.update,
    ].reduce((count, method) => count + method.mock.calls.length, 0);
    expect(entityUpdatesAfterReconciliation).toBe(entityUpdatesBeforeReconciliation);

    const replay = await currentWriter.execute(input, preview);
    expect(replay).toMatchObject({
      inserted: 0,
      updated: 0,
      skipped: reconciled.skipped,
      publicationStatus: 'PUBLISHED',
    });
  });

  it('reuses a reviewed canonical player without moving their legacy club team', async () => {
    const input = validImport();
    input.players[0].canonicalChampionDataPlayerId = 12345;
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const { prisma, state } = createFakePrisma();
    state.players.set('canonical-player', {
      id: 'canonical-player',
      name: 'Test Player',
      position: 'WA',
      teamId: 'legacy-club-team',
      championDataPlayerId: 12345,
    });
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });

    await writer.execute(input, preview);

    expect(state.players).toHaveLength(1);
    expect(state.players.get('canonical-player')).toMatchObject({
      name: 'Test Player',
      position: 'WA',
      teamId: 'legacy-club-team',
      championDataPlayerId: 12345,
    });
    expect([...state.rosters.values()][0]).toMatchObject({
      playerId: 'canonical-player',
      designatedPosition: 'C',
    });
    expect([...state.mappings.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'PLAYER',
        externalId: 'player-1',
        internalEntityId: 'canonical-player',
      }),
    ]));
  });

  it('does not rename or update a mapped Champion Data player when canonical review is omitted', async () => {
    const firstInput = validImport();
    const { prisma, state } = createFakePrisma();
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });
    const firstPreview = planCompetitionImport(firstInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(firstInput, firstPreview);

    const player = [...state.players.values()][0];
    state.players.set(String(player.id), {
      ...player,
      name: 'Canonical Display Name',
      position: 'WA',
      championDataPlayerId: 98765,
      photoUrl: 'https://canonical.example.test/photo.jpg',
    });
    const revisedInput = structuredClone(firstInput);
    revisedInput.context.retrievedAt = '2026-07-16T00:00:00.000Z';
    revisedInput.players[0] = {
      ...revisedInput.players[0],
      name: 'Unreviewed Rename',
      position: 'GK',
      photoUrl: 'https://unreviewed.example.test/photo.jpg',
      photoSourceUrl: 'https://unreviewed.example.test/source',
      photoLicense: 'CC BY 4.0',
    };
    const revisedPreview = planCompetitionImport(revisedInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: importedIdentities(state.mappings),
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });

    await writer.execute(revisedInput, revisedPreview);

    expect(state.players.get(String(player.id))).toMatchObject({
      name: 'Canonical Display Name',
      position: 'WA',
      championDataPlayerId: 98765,
      photoUrl: 'https://canonical.example.test/photo.jpg',
    });
  });

  it('rejects a stale reviewed canonical mapping before skipping an exact replay', async () => {
    const input = validImport();
    input.players[0].canonicalChampionDataPlayerId = 12345;
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const { prisma, state } = createFakePrisma();
    state.players.set('canonical-player', {
      id: 'canonical-player',
      name: 'Test Player',
      position: 'WA',
      teamId: 'legacy-club-team',
      championDataPlayerId: 12345,
    });
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });

    await writer.execute(input, preview);
    const mapping = [...state.mappings.values()].find((candidate) =>
      candidate.entityType === 'PLAYER' && candidate.externalId === 'player-1'
    );
    expect(mapping).toBeDefined();
    state.players.set('wrong-player', {
      id: 'wrong-player',
      name: 'Wrong Player',
      position: 'C',
      teamId: 'wrong-team',
      championDataPlayerId: null,
    });
    state.mappings.set(String(mapping?.id), {
      ...mapping,
      internalEntityId: 'wrong-player',
    });

    await expect(writer.execute(input, preview)).rejects.toThrow(
      'Reviewed canonical player mapping mismatch: player-1/wrong-player/canonical-player',
    );
    expect(state.players.get('canonical-player')).toMatchObject({
      championDataPlayerId: 12345,
      teamId: 'legacy-club-team',
    });
    expect(state.players.get('wrong-player')).toMatchObject({
      name: 'Wrong Player',
      teamId: 'wrong-team',
    });
  });

  it('rejects a missing reviewed canonical mapping on an exact replay', async () => {
    const input = validImport();
    input.players[0].canonicalChampionDataPlayerId = 12345;
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const { prisma, state } = createFakePrisma();
    state.players.set('canonical-player', {
      id: 'canonical-player',
      name: 'Test Player',
      position: 'WA',
      teamId: 'legacy-club-team',
      championDataPlayerId: 12345,
    });
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });

    await writer.execute(input, preview);
    for (const [id, mapping] of state.mappings) {
      if (mapping.entityType === 'PLAYER' && mapping.externalId === 'player-1') {
        state.mappings.delete(id);
      }
    }

    await expect(writer.execute(input, preview)).rejects.toThrow(
      'Reviewed canonical player mapping is missing on replay: player-1/canonical-player',
    );
  });

  it.each(['TEAM', 'PLAYER', 'MATCH'] as const)(
    'validates every %s mapping target before exact replay',
    async (entityType) => {
      const input = validImport();
      const preview = planCompetitionImport(input, {
        sourceSystemId: 'source-id',
        competitionId: 'edition-id',
        existingIdentities: [],
        knownStageSlugs: ['pool-stage'],
        standingsStrategyKey: 'INTERNATIONAL_POOL',
      });
      const { prisma, state } = createFakePrisma();
      const writer = new PrismaCompetitionImportWriter(prisma, {
        sourceSystemId: 'source-id',
        competitionId: 'edition-id',
        editionSourceId: 'edition-source-id',
      });
      await writer.execute(input, preview);
      const mapping = [...state.mappings.values()].find((candidate) =>
        candidate.entityType === entityType
      );
      expect(mapping).toBeDefined();
      const targetId = String(mapping?.internalEntityId);
      if (entityType === 'TEAM') {
        state.teams.set(targetId, {
          ...state.teams.get(targetId),
          competitionId: 'other-edition',
        });
      } else if (entityType === 'MATCH') {
        state.matches.set(targetId, {
          ...state.matches.get(targetId),
          competitionId: 'other-edition',
        });
      } else {
        state.players.delete(targetId);
      }

      await expect(writer.execute(input, preview)).rejects.toThrow(
        entityType === 'PLAYER'
          ? `PLAYER source mapping target does not exist: player-1/${targetId}`
          : `${entityType} source mapping target belongs to another edition`,
      );
    },
  );

  it('rejects duplicate persisted source identities before exact replay', async () => {
    const input = validImport();
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const { prisma, state } = createFakePrisma();
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });
    await writer.execute(input, preview);
    const mapping = [...state.mappings.values()][0];
    state.mappings.set('duplicate-mapping', { ...mapping, id: 'duplicate-mapping' });

    await expect(writer.execute(input, preview)).rejects.toThrow(
      `Duplicate source mapping identity: ${mapping.entityType}:${mapping.externalId}`,
    );
  });

  it('requires the selected edition status and a matching recorded dry-run', async () => {
    const input = validImport();
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const published = createFakePrisma('PUBLISHED');
    const publishedWriter = new PrismaCompetitionImportWriter(published.prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
    });
    await expect(publishedWriter.execute(input, preview)).rejects.toThrow(
      'Import requires DRAFT edition status; found PUBLISHED',
    );

    const draft = createFakePrisma('DRAFT');
    const options = {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT' as const,
      requireMatchingDryRun: true,
      receiptMetadata: { importKind: 'GLASGOW_FOUNDATION' },
    };
    const draftWriter = new PrismaCompetitionImportWriter(draft.prisma, options);
    await expect(draftWriter.execute(input, preview)).rejects.toThrow(
      `Apply requires a recorded clean dry-run receipt with matching provenance for checksum ${preview.checksum}`,
    );

    const stalePreview = await recordPrismaImportPreview(draft.prisma, options, input, preview);
    const staleRun = draft.state.runs.get(stalePreview.importRunId);
    expect(staleRun?.startedAt).toBeInstanceOf(Date);
    expect(staleRun?.completedAt).toBe(staleRun?.startedAt);
    draft.state.runs.set(stalePreview.importRunId, {
      ...staleRun,
      metadata: { importKind: 'OTHER_IMPORT' },
    });
    await expect(draftWriter.execute(input, preview)).rejects.toThrow(
      `Apply requires a recorded clean dry-run receipt with matching provenance for checksum ${preview.checksum}`,
    );

    await recordPrismaImportPreview(draft.prisma, options, input, preview);
    const stateMismatchedPreview = structuredClone(preview);
    stateMismatchedPreview.writes[0].reason = 'Different database planning state';
    await expect(draftWriter.execute(input, stateMismatchedPreview)).rejects.toThrow(
      `Apply requires a recorded clean dry-run receipt with matching provenance for checksum ${preview.checksum}`,
    );
    await expect(draftWriter.execute(input, preview)).resolves.toMatchObject({
      publicationStatus: 'DRAFT',
    });
  });

  it('locks the edition before publication checks for recorded previews and applies', async () => {
    const input = validImport();
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const recordRace = createFakePrisma('DRAFT', {
      beforeCompetitionLock: (state) => {
        state.publicationStatus = 'PUBLISHED';
      },
    });
    const options = {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT' as const,
    };

    await expect(recordPrismaImportPreview(
      recordRace.prisma,
      options,
      input,
      preview,
    )).rejects.toThrow('Import requires DRAFT edition status; found PUBLISHED');
    expect(recordRace.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(recordRace.tx.sourceSystem.findUnique).not.toHaveBeenCalled();

    const applyRace = createFakePrisma('DRAFT', {
      beforeCompetitionLock: (state) => {
        state.publicationStatus = 'PUBLISHED';
      },
    });
    const writer = new PrismaCompetitionImportWriter(applyRace.prisma, options);
    await expect(writer.execute(input, preview)).rejects.toThrow(
      'Import requires DRAFT edition status; found PUBLISHED',
    );
    expect(applyRace.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(applyRace.tx.sourceSystem.findUnique).not.toHaveBeenCalled();
  });

  it('closes stale active roster memberships absent from a revised complete snapshot', async () => {
    const firstInput = validImport();
    const { prisma, state } = createFakePrisma('DRAFT');
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
      completeEditionRosterSnapshot: true,
    });
    const firstPreview = planCompetitionImport(firstInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(firstInput, firstPreview);

    const revisedInput = structuredClone(firstInput);
    revisedInput.rosters = [];
    revisedInput.context.retrievedAt = '2026-07-16T00:00:00.000Z';
    const revisedPreview = planCompetitionImport(revisedInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [...state.mappings.values()].map((mapping) => ({
        entityType: mapping.entityType as 'TEAM' | 'PLAYER' | 'MATCH',
        externalId: String(mapping.externalId),
        internalEntityId: String(mapping.internalEntityId),
      })),
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(revisedInput, revisedPreview);

    expect([...state.rosters.values()][0]).toMatchObject({
      status: 'REPLACED',
      validTo: new Date('2026-07-16T00:00:00.000Z'),
      notes: 'Closed by complete source-snapshot reconciliation',
    });
    expect(state.mutations).toContainEqual(expect.objectContaining({
      target: 'ROSTER_MEMBERSHIP',
      operation: 'UPDATE',
    }));
  });

  it('preserves unrelated rosters for a partial snapshot by default', async () => {
    const firstInput = validImport();
    const { prisma, state } = createFakePrisma('DRAFT');
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
    });
    const firstPreview = planCompetitionImport(firstInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(firstInput, firstPreview);

    const partialInput = structuredClone(firstInput);
    partialInput.rosters = [];
    partialInput.context.retrievedAt = '2026-07-16T00:00:00.000Z';
    const partialPreview = planCompetitionImport(partialInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: importedIdentities(state.mappings),
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(partialInput, partialPreview);

    expect([...state.rosters.values()][0]).toMatchObject({ status: 'ACTIVE' });
    expect([...state.rosters.values()][0].validTo).toBeUndefined();
  });

  it('preserves result-owned and resolved bracket state during schedule-only correction', async () => {
    const firstInput = validImport();
    firstInput.teams[0].groupSlug = 'pool-a';
    firstInput.teams[1].groupSlug = 'pool-a';
    firstInput.matches[0].groupSlug = 'pool-a';
    const { prisma, state } = createFakePrisma('DRAFT');
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
    });
    const firstPreview = planCompetitionImport(firstInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      knownGroupSlugs: ['pool-a'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(firstInput, firstPreview);

    const match = [...state.matches.values()][0];
    const resultUpdatedAt = new Date('2026-07-15T12:00:00.000Z');
    state.matches.set(String(match.id), {
      ...match,
      status: 'COMPLETED',
      homeScore: 61,
      awayScore: 59,
      resultQuality: 'OFFICIAL_FINAL',
      sourceUpdatedAt: resultUpdatedAt,
    });
    const originalSlots = [...state.slots.values()].map((slot) => ({
      ...slot,
      id: String(slot.id),
      resolvedEntryId: typeof slot.resolvedEntryId === 'string'
        ? slot.resolvedEntryId
        : null,
      sourceType: 'GROUP_RANK',
      sourceGroupId: 'group-a',
      resolvedAt: new Date('2026-07-15T10:00:00.000Z'),
    }));
    for (const slot of originalSlots) state.slots.set(String(slot.id), slot);

    const correction = structuredClone(firstInput);
    correction.context.retrievedAt = '2026-07-16T00:00:00.000Z';
    correction.results = [];
    correction.matches[0].scheduledAt = '2026-07-26T09:00:00.000Z';
    correction.matches[0].status = 'SCHEDULED';
    correction.matches[0].sideA = {
      sourceType: 'GROUP_RANK',
      sourceGroupSlug: 'pool-a',
      sourceRank: 1,
      sourceLabel: 'Pool A 1st',
    };
    correction.matches[0].sideB = {
      sourceType: 'GROUP_RANK',
      sourceGroupSlug: 'pool-a',
      sourceRank: 2,
      sourceLabel: 'Pool A 2nd',
    };
    const correctionPreview = planCompetitionImport(correction, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: importedIdentities(state.mappings),
      knownStageSlugs: ['pool-stage'],
      knownGroupSlugs: ['pool-a'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(correction, correctionPreview);

    expect(state.matches.get(String(match.id))).toMatchObject({
      status: 'COMPLETED',
      homeScore: 61,
      awayScore: 59,
      resultQuality: 'OFFICIAL_FINAL',
      sourceUpdatedAt: resultUpdatedAt,
      scheduledAt: new Date('2026-07-26T09:00:00.000Z'),
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
    });
    for (const originalSlot of originalSlots) {
      expect(state.slots.get(String(originalSlot.id))).toMatchObject({
        resolvedEntryId: originalSlot.resolvedEntryId,
        resolvedAt: originalSlot.resolvedAt,
      });
    }

    const staleParticipantCorrection = structuredClone(correction);
    staleParticipantCorrection.context.retrievedAt = '2026-07-17T00:00:00.000Z';
    staleParticipantCorrection.matches[0].sideA = { teamExternalId: 'NZL' };
    staleParticipantCorrection.matches[0].sideB = { teamExternalId: 'AUS' };
    const staleParticipantPreview = planCompetitionImport(staleParticipantCorrection, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: importedIdentities(state.mappings),
      knownStageSlugs: ['pool-stage'],
      knownGroupSlugs: ['pool-a'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await writer.execute(staleParticipantCorrection, staleParticipantPreview);
    expect(state.matches.get(String(match.id))).toMatchObject({
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      status: 'COMPLETED',
      homeScore: 61,
      awayScore: 59,
    });
    for (const originalSlot of originalSlots) {
      expect(state.slots.get(String(originalSlot.id))).toMatchObject({
        resolvedEntryId: originalSlot.resolvedEntryId,
        resolvedAt: originalSlot.resolvedAt,
      });
    }
  });

  it('requires explicit precedence before replacing another coverage provider', async () => {
    const firstInput = validImport();
    const { prisma, state } = createFakePrisma('DRAFT');
    const defaultWriter = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
    });
    const firstPreview = planCompetitionImport(firstInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await defaultWriter.execute(firstInput, firstPreview);
    for (const [id, coverage] of state.coverage) {
      state.coverage.set(id, { ...coverage, sourceSystemId: 'other-source' });
    }

    const revisedInput = structuredClone(firstInput);
    revisedInput.context.retrievedAt = '2026-07-16T00:00:00.000Z';
    const revisedPreview = planCompetitionImport(revisedInput, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: importedIdentities(state.mappings),
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    await expect(defaultWriter.execute(revisedInput, revisedPreview)).rejects.toThrow(
      'Coverage source conflict requires explicit incoming-source precedence',
    );

    const authoritativeWriter = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
      coverageSourcePrecedence: 'INCOMING_SOURCE',
    });
    await authoritativeWriter.execute(revisedInput, revisedPreview);
    expect([...state.coverage.values()].every((coverage) =>
      coverage.sourceSystemId === 'source-id'
    )).toBe(true);
  });

  it('rolls back every canonical write when the atomic audit flush fails', async () => {
    const input = validImport();
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
    });
    const { prisma, state, tx } = createFakePrisma('DRAFT');
    tx.importMutation.createMany.mockRejectedValueOnce(new Error('audit flush failed'));
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
    });

    await expect(writer.execute(input, preview)).rejects.toThrow('audit flush failed');

    expect(state.teams).toHaveLength(0);
    expect(state.entries).toHaveLength(0);
    expect(state.players).toHaveLength(0);
    expect(state.rosters).toHaveLength(0);
    expect(state.matches).toHaveLength(0);
    expect(state.slots).toHaveLength(0);
    expect(state.coverage).toHaveLength(0);
    expect(state.mappings).toHaveLength(0);
    expect(state.snapshots).toHaveLength(0);
    expect(state.mutations).toHaveLength(0);
    expect(state.editionSource.lastSyncedAt).toBeNull();
    expect([...state.runs.values()]).toEqual([
      expect.objectContaining({ status: 'FAILED', errorMessage: 'audit flush failed' }),
    ]);
  });

  it('imports and replays the complete 12-team Glasgow bundle within bounded query budgets', async () => {
    const input = JSON.parse(readFileSync(
      path.resolve('data/glasgow-2026/v1/bundle.json'),
      'utf8',
    )) as NormalizedCompetitionImport;
    const preview = planCompetitionImport(input, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      existingIdentities: [],
      knownStageSlugs: ['pool-stage', 'classification', 'semi-finals', 'medal-matches'],
      knownGroupSlugs: ['pool-a', 'pool-b'],
      standingsStrategyKey: 'INTERNATIONAL_POOL',
      allowUnresolvedMatches: true,
    });
    expect(preview.valid).toBe(true);
    const { prisma, state, tx } = createFakePrisma('DRAFT', {
      reverseBulkReturns: true,
      sourceKey: 'glasgow-2026-public-data',
      editionExternalId: 'glasgow-2026',
    });
    for (const player of input.players) {
      if (player.canonicalChampionDataPlayerId === undefined) continue;
      state.players.set(`canonical-${player.externalId}`, {
        id: `canonical-${player.externalId}`,
        name: player.name,
        position: player.position,
        teamId: `legacy-${player.teamExternalId}`,
        championDataPlayerId: player.canonicalChampionDataPlayerId,
      });
    }
    const writer = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      expectedPublicationStatus: 'DRAFT',
      completeEditionRosterSnapshot: true,
      coverageSourcePrecedence: 'INCOMING_SOURCE',
    });

    const first = await writer.execute(input, preview);
    const freshStatements = transactionStatementCount(tx);
    const statementsBeforeReplay = freshStatements;
    const replay = await writer.execute(input, preview);
    const replayStatements = transactionStatementCount(tx) - statementsBeforeReplay;

    expect(state.teams).toHaveLength(12);
    expect(state.players).toHaveLength(96);
    expect(state.rosters).toHaveLength(96);
    expect(state.matches).toHaveLength(38);
    expect(state.slots).toHaveLength(76);
    expect(state.mappings).toHaveLength(146);
    expect(first.inserted + first.updated + first.skipped).toBe(488);
    expect(replay).toMatchObject({ inserted: 0, updated: 0, skipped: 488 });
    expect(freshStatements).toBeLessThanOrEqual(50);
    expect(replayStatements).toBeLessThanOrEqual(20);
  });
});
