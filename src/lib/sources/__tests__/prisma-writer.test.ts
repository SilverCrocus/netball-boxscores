import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { planCompetitionImport } from '@/lib/sources/planner';
import {
  PrismaCompetitionImportWriter,
  recordPrismaImportPreview,
} from '@/lib/sources/prisma-writer';
import { validImport } from '@/lib/sources/__tests__/fixtures';

function createFakePrisma(publicationStatus: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED') {
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
  };
  const create = (map: Map<string, Record<string, unknown>>, prefix: string) =>
    vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: data.id ?? nextId(prefix), ...data };
      map.set(String(row.id), row);
      return row;
    });
  const update = (map: Map<string, Record<string, unknown>>) =>
    vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...map.get(where.id), ...data, id: where.id };
      map.set(where.id, row);
      return row;
    });

  const tx = {
    sourceSystem: {
      findUnique: vi.fn(async () => ({
        id: 'source-id',
        key: 'manual',
        rawPayloadStorageAllowed: true,
      })),
    },
    editionSource: {
      findUnique: vi.fn(async () => ({
        id: 'edition-source-id',
        competitionId: 'edition-id',
        sourceSystemId: 'source-id',
        externalId: 'test-2026',
      })),
      update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    competition: {
      findUnique: vi.fn(async () => ({ publicationStatus })),
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
    },
    stage: {
      findMany: vi.fn(async () => [{ id: 'stage-pool', slug: 'pool-stage' }]),
    },
    stageGroup: {
      findMany: vi.fn(async () => [{
        id: 'group-a',
        slug: 'pool-a',
        stageId: 'stage-pool',
        stage: { slug: 'pool-stage' },
      }]),
    },
    sourceEntityMapping: {
      findMany: vi.fn(async () => [...state.mappings.values()]),
      create: create(state.mappings, 'mapping'),
      update: update(state.mappings),
    },
    team: {
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
      update: update(state.teams),
    },
    editionEntry: {
      findUnique: vi.fn(async ({ where }) => {
        const key = where.competitionId_teamId;
        return [...state.entries.values()].find((entry) =>
          entry.competitionId === key.competitionId && entry.teamId === key.teamId
        ) ?? null;
      }),
      create: create(state.entries, 'entry'),
      update: update(state.entries),
    },
    player: {
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
      update: update(state.players),
    },
    rosterMembership: {
      findMany: vi.fn(async () => [...state.rosters.values()].filter((roster) =>
        roster.status === 'ACTIVE' && roster.validTo == null
      )),
      findFirst: vi.fn(async ({ where }) =>
        [...state.rosters.values()].find((roster) =>
          roster.editionEntryId === where.editionEntryId &&
          roster.playerId === where.playerId &&
          roster.validTo == null
        ) ?? null),
      create: create(state.rosters, 'roster'),
      update: update(state.rosters),
    },
    match: {
      findUnique: vi.fn(async ({ where }) => state.matches.get(where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }) => {
        const row = state.matches.get(where.id);
        if (!row) throw new Error('missing match');
        return row;
      }),
      create: create(state.matches, 'match'),
      update: update(state.matches),
    },
    matchSlot: {
      findUnique: vi.fn(async ({ where }) => {
        const key = where.matchId_side;
        return [...state.slots.values()].find((slot) =>
          slot.matchId === key.matchId && slot.side === key.side
        ) ?? null;
      }),
      create: create(state.slots, 'slot'),
      update: update(state.slots),
    },
    matchQuarter: {
      findUnique: vi.fn(async ({ where }) => {
        const key = where.matchId_quarter;
        return [...state.quarters.values()].find((quarter) =>
          quarter.matchId === key.matchId && quarter.quarter === key.quarter
        ) ?? null;
      }),
      create: create(state.quarters, 'quarter'),
      update: update(state.quarters),
    },
    dataCoverage: {
      findFirst: vi.fn(async ({ where }) =>
        [...state.coverage.values()].find((coverage) =>
          coverage.competitionId === where.competitionId &&
          coverage.matchId === where.matchId &&
          coverage.capability === where.capability
        ) ?? null),
      create: create(state.coverage, 'coverage'),
      update: update(state.coverage),
    },
    sourceSnapshot: {
      findUnique: vi.fn(async ({ where }) =>
        [...state.snapshots.values()].find((snapshot) => snapshot.dedupeKey === where.dedupeKey) ?? null),
      create: create(state.snapshots, 'snapshot'),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(tx)),
    importRun: tx.importRun,
  } as unknown as PrismaClient;
  return { prisma, state };
}

describe('PrismaCompetitionImportWriter', () => {
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

    const { prisma, state } = createFakePrisma();
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
    ]));
    expect(first.inserted).toBe(
      state.mutations.filter((mutation) => mutation.operation === 'INSERT').length,
    );
    expect(first.updated).toBe(
      state.mutations.filter((mutation) => mutation.operation === 'UPDATE').length,
    );
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
      skipped: preview.writes.length,
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

    const { prisma } = createFakePrisma();
    const legacyWriter = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
    });
    await legacyWriter.execute(input, preview);

    const currentWriter = new PrismaCompetitionImportWriter(prisma, {
      sourceSystemId: 'source-id',
      competitionId: 'edition-id',
      editionSourceId: 'edition-source-id',
      receiptMetadata: { importKind: 'GLASGOW_FOUNDATION' },
    });
    const reconciled = await currentWriter.execute(input, preview);
    expect(reconciled).toMatchObject({
      skipped: 0,
      publicationStatus: 'PUBLISHED',
    });
    expect(reconciled.inserted + reconciled.updated).toBeGreaterThan(0);

    const replay = await currentWriter.execute(input, preview);
    expect(replay).toMatchObject({
      inserted: 0,
      updated: 0,
      skipped: preview.writes.length,
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
    await expect(draftWriter.execute(input, preview)).resolves.toMatchObject({
      publicationStatus: 'DRAFT',
    });
  });

  it('closes stale active roster memberships absent from a revised complete snapshot', async () => {
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
});
