import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  GlasgowResultsImportService,
  type GlasgowResultsImportInput,
  validateGlasgowResultsInput,
} from '@/lib/glasgow/results-import';

function resultInput(): GlasgowResultsImportInput {
  return {
    schemaVersion: 1,
    edition: 'glasgow-2026',
    sourceKey: 'glasgow-2026-public-data',
    retrievedAt: '2026-07-25T11:00:00.000Z',
    sourceManifest: {
      schemaVersion: 1,
      version: 'results-2026-07-25T11:00:00Z',
      checksum: 'a'.repeat(64),
      sources: [{
        id: 'official-result',
        url: 'https://example.test/official-result',
        retrievedAt: '2026-07-25T11:00:00.000Z',
        purpose: 'official final score and periods',
      }],
    },
    results: [{
      matchExternalId: 'pool-match-1',
      sideAExternalId: 'AUS',
      sideBExternalId: 'NZL',
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      sideAScore: 60,
      sideBScore: 50,
      sourceUpdatedAt: '2026-07-25T10:59:00.000Z',
      periods: [
        { period: 1, sideAScore: 15, sideBScore: 12 },
        { period: 2, sideAScore: 14, sideBScore: 13 },
        { period: 3, sideAScore: 16, sideBScore: 11 },
        { period: 4, sideAScore: 15, sideBScore: 14 },
      ],
    }],
  };
}

function fakeResultsPrisma(
  publicationStatus: 'DRAFT' | 'PUBLISHED' = 'PUBLISHED',
  options: { includeMatchMapping?: boolean } = {},
) {
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const state = {
    runs: [] as Array<Record<string, unknown>>,
    mutations: [] as Array<Record<string, unknown>>,
    coverage: [] as Array<Record<string, unknown>>,
    standings: [] as Array<Record<string, unknown>>,
    snapshots: [] as Array<Record<string, unknown>>,
    matches: new Map<string, Record<string, unknown>>(),
    slots: new Map<string, Record<string, unknown>>(),
    quarters: new Map<string, Record<string, unknown>>(),
  };
  const directA = {
    id: 'slot-pool-a',
    matchId: 'match-pool-1',
    side: 'A',
    sourceType: 'TEAM',
    resolvedEntryId: 'entry-aus',
    sourceMatchId: null,
  };
  const directB = {
    id: 'slot-pool-b',
    matchId: 'match-pool-1',
    side: 'B',
    sourceType: 'TEAM',
    resolvedEntryId: 'entry-nzl',
    sourceMatchId: null,
  };
  const dependent = {
    id: 'slot-semi-a',
    matchId: 'match-semi-1',
    side: 'A',
    sourceType: 'MATCH_WINNER',
    resolvedEntryId: null,
    sourceMatchId: 'match-pool-1',
  };
  state.slots.set(directA.id, directA);
  state.slots.set(directB.id, directB);
  state.slots.set(dependent.id, dependent);
  state.matches.set('match-pool-1', {
    id: 'match-pool-1',
    competitionId: 'glasgow-edition',
    stageId: 'pool-stage',
    stageGroupId: 'pool-a',
    status: 'SCHEDULED',
    resultQuality: 'UNKNOWN',
    homeScore: 0,
    awayScore: 0,
    homeTeamId: 'team-aus',
    awayTeamId: 'team-nzl',
    sourceUpdatedAt: null,
    isSimulation: false,
  });
  state.matches.set('match-semi-1', {
    id: 'match-semi-1',
    competitionId: 'glasgow-edition',
    stageId: 'semi-finals',
    stageGroupId: null,
    status: 'SCHEDULED',
    resultQuality: 'UNKNOWN',
    homeScore: 0,
    awayScore: 0,
    homeTeamId: null,
    awayTeamId: null,
    sourceUpdatedAt: null,
    isSimulation: false,
  });

  const updateMap = (map: Map<string, Record<string, unknown>>) => vi.fn(async ({ where, data }) => {
    const row = { ...map.get(where.id), ...data, id: where.id };
    map.set(where.id, row);
    return row;
  });
  const runsMatching = (where: Record<string, unknown>) => state.runs.filter((run) =>
    Object.entries(where).every(([key, value]) => value === undefined || run[key] === value)
  );
  const tx = {
    competition: {
      findFirst: vi.fn(async () => ({ id: 'glasgow-edition', publicationStatus })),
    },
    sourceSystem: {
      findUnique: vi.fn(async () => ({ id: 'glasgow-source', rawPayloadStorageAllowed: true })),
    },
    editionSource: {
      findFirst: vi.fn(async () => ({ id: 'glasgow-edition-source' })),
      update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    sourceEntityMapping: {
      findMany: vi.fn(async ({ where }) => where.entityType === 'MATCH'
        ? (options.includeMatchMapping === false
          ? []
          : [{ externalId: 'pool-match-1', internalEntityId: 'match-pool-1' }])
        : [
          { externalId: 'AUS', internalEntityId: 'team-aus' },
          { externalId: 'NZL', internalEntityId: 'team-nzl' },
        ]),
    },
    importRun: {
      findMany: vi.fn(async ({ where, take }) => runsMatching(where).slice(0, take)),
      findFirst: vi.fn(async ({ where }) => runsMatching(where)[0] ?? null),
      create: vi.fn(async ({ data }) => {
        const row = { ...data, id: data.id ?? id('run') };
        state.runs.unshift(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const index = state.runs.findIndex((run) => run.id === where.id);
        const row = { ...state.runs[index], ...data, id: where.id };
        state.runs[index] = row;
        return row;
      }),
    },
    match: {
      findMany: vi.fn(async ({ where }) => {
        if (where.id?.in) {
          return where.id.in.flatMap((matchId: string) => {
            const match = state.matches.get(matchId);
            if (!match) return [];
            return [{
              ...match,
              slots: [...state.slots.values()].filter((slot) => slot.matchId === matchId),
              quarters: [...state.quarters.values()].filter((quarter) => quarter.matchId === matchId),
            }];
          });
        }
        return [...state.matches.values()]
          .filter((match) => match.stageId === where.stageId && match.status === 'COMPLETED')
          .map((match) => ({
            ...match,
            slots: [...state.slots.values()].filter((slot) => slot.matchId === match.id),
          }));
      }),
      findUniqueOrThrow: vi.fn(async ({ where }) => {
        const match = state.matches.get(where.id);
        if (!match) throw new Error('missing match');
        return match;
      }),
      update: updateMap(state.matches),
    },
    editionEntry: {
      findMany: vi.fn(async () => [
        { id: 'entry-aus', teamId: 'team-aus' },
        { id: 'entry-nzl', teamId: 'team-nzl' },
      ]),
      findUniqueOrThrow: vi.fn(async ({ where }) => ({
        teamId: where.id === 'entry-aus' ? 'team-aus' : 'team-nzl',
      })),
    },
    matchSlot: {
      findMany: vi.fn(async ({ where }) => [...state.slots.values()]
        .filter((slot) => slot.sourceMatchId === where.sourceMatchId)),
      update: updateMap(state.slots),
    },
    matchQuarter: {
      create: vi.fn(async ({ data }) => {
        const row = { ...data, id: id('quarter') };
        state.quarters.set(row.id, row);
        return row;
      }),
      update: updateMap(state.quarters),
    },
    dataCoverage: {
      findFirst: vi.fn(async ({ where }) => state.coverage.find((item) =>
        item.matchId === where.matchId && item.capability === where.capability
      ) ?? null),
      create: vi.fn(async ({ data }) => {
        const row = { ...data, id: id('coverage') };
        state.coverage.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const index = state.coverage.findIndex((item) => item.id === where.id);
        const row = { ...state.coverage[index], ...data, id: where.id };
        state.coverage[index] = row;
        return row;
      }),
    },
    importMutation: {
      create: vi.fn(async ({ data }) => {
        const row = { ...data, id: id('mutation') };
        state.mutations.push(row);
        return row;
      }),
    },
    stage: {
      findFirst: vi.fn(async () => ({
        id: 'pool-stage',
        groups: [{
          id: 'pool-a',
          primaryEntries: [
            { id: 'entry-aus', seed: 1, displayName: 'Australia' },
            { id: 'entry-nzl', seed: 2, displayName: 'New Zealand' },
          ],
        }],
      })),
    },
    stageStanding: {
      findFirst: vi.fn(async ({ where }) => state.standings.find((standing) =>
        standing.stageGroupId === where.stageGroupId
        && standing.editionEntryId === where.editionEntryId
      ) ?? null),
      create: vi.fn(async ({ data }) => {
        const row = { ...data, id: id('standing') };
        state.standings.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }) => {
        const index = state.standings.findIndex((standing) => standing.id === where.id);
        const row = { ...state.standings[index], ...data, id: where.id };
        state.standings[index] = row;
        return row;
      }),
    },
    sourceSnapshot: {
      upsert: vi.fn(async ({ create }) => {
        const row = { ...create, id: id('snapshot') };
        state.snapshots.push(row);
        return row;
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(tx)),
    importRun: tx.importRun,
  } as unknown as PrismaClient;
  return { prisma, state };
}

describe('Glasgow results input validation', () => {
  it('rejects duplicate results, negative scores, duplicate periods, and period total mismatches', () => {
    const input = resultInput();
    input.results[0].sideAScore = -1;
    input.results[0].periods![1].period = 3;
    input.results.push(structuredClone(input.results[0]));

    expect(validateGlasgowResultsInput(input).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'INVALID_SCORE',
        'DUPLICATE_PERIOD',
        'NON_CONTIGUOUS_PERIODS',
        'PERIOD_TOTAL_MISMATCH',
        'DUPLICATE_RESULT',
      ]),
    );
  });

  it('requires explicit evidence for corrected results and rejects invalid status/quality pairs', () => {
    const corrected = resultInput();
    corrected.results[0].resultQuality = 'CORRECTED';
    expect(validateGlasgowResultsInput(corrected).map((issue) => issue.code)).toContain(
      'MISSING_CORRECTION_EVIDENCE',
    );

    const live = resultInput();
    live.results[0].status = 'LIVE';
    expect(validateGlasgowResultsInput(live).map((issue) => issue.code)).toContain(
      'INVALID_STATUS_QUALITY',
    );
  });

  it('reports malformed nested JSON instead of throwing before validation', () => {
    const malformed = resultInput() as unknown as Record<string, unknown>;
    malformed.results = [null];
    malformed.sourceManifest = {
      ...(malformed.sourceManifest as Record<string, unknown>),
      sources: [null],
    };

    const issues = validateGlasgowResultsInput(
      malformed as unknown as GlasgowResultsImportInput,
    );
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_RESULT' }),
      expect.objectContaining({ code: 'INVALID_SOURCE_MANIFEST' }),
    ]));
  });

  it('requires a persisted normalized artifact checksum to be reproducible', () => {
    const input = resultInput();
    input.sourceManifest.normalizedArtifact = [{ providerMatchCode: 'match-1' }];

    expect(validateGlasgowResultsInput(input)).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_MANIFEST_CHECKSUM_MISMATCH' }),
    );
  });
});

describe('Glasgow guarded results import', () => {
  it('rejects a draft edition because published writes must use this explicit guarded flow', async () => {
    const { prisma } = fakeResultsPrisma('DRAFT');
    const preview = await new GlasgowResultsImportService(prisma).preview(resultInput());
    expect(preview.valid).toBe(false);
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'EDITION_NOT_PUBLISHED' }));
  });

  it('refuses to create a result for a match that is not already mapped', async () => {
    const { prisma } = fakeResultsPrisma('PUBLISHED', { includeMatchMapping: false });
    const preview = await new GlasgowResultsImportService(prisma).preview(resultInput());

    expect(preview.valid).toBe(false);
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'MATCH_NOT_FOUND' }));
  });

  it('rejects a completed draw when winner or loser slots depend on the match', async () => {
    const { prisma, state } = fakeResultsPrisma();
    const service = new GlasgowResultsImportService(prisma);
    const input = resultInput();
    input.results[0].sideAScore = 50;
    input.results[0].sideBScore = 50;
    input.results[0].periods = [
      { period: 1, sideAScore: 13, sideBScore: 12 },
      { period: 2, sideAScore: 12, sideBScore: 13 },
      { period: 3, sideAScore: 13, sideBScore: 12 },
      { period: 4, sideAScore: 12, sideBScore: 13 },
    ];
    const recorded = await service.recordPreview(input);

    await expect(service.apply(input, recorded.preview.confirmationToken!)).rejects.toThrow(
      'cannot be a draw',
    );
    const failedRun = state.runs.find((run) => run.status === 'FAILED');
    expect(failedRun?.startedAt).toBeInstanceOf(Date);
    expect(failedRun?.completedAt).toBeInstanceOf(Date);
    expect((failedRun?.completedAt as Date).getTime()).toBeGreaterThanOrEqual(
      (failedRun?.startedAt as Date).getTime(),
    );
  });

  it('requires a recorded dry-run, applies atomically, reconciles standings and knockout slots, and skips an exact replay', async () => {
    const { prisma, state } = fakeResultsPrisma();
    const service = new GlasgowResultsImportService(prisma);
    const input = resultInput();
    const preview = await service.preview(input);
    expect(preview).toMatchObject({ valid: true, resultCount: 1 });

    await expect(service.apply(input, preview.confirmationToken!)).rejects.toThrow(
      'requires a recorded clean dry-run',
    );
    const recorded = await service.recordPreview(input);
    const recordedRun = state.runs.find((run) => run.id === recorded.importRunId);
    expect(recordedRun?.startedAt).toBeInstanceOf(Date);
    expect(recordedRun?.completedAt).toBe(recordedRun?.startedAt);
    const receipt = await service.apply(input, recorded.preview.confirmationToken!);

    expect(state.matches.get('match-pool-1')).toMatchObject({
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      homeScore: 60,
      awayScore: 50,
    });
    expect(state.slots.get('slot-semi-a')).toMatchObject({ resolvedEntryId: 'entry-aus' });
    expect(state.matches.get('match-semi-1')).toMatchObject({ homeTeamId: 'team-aus' });
    expect(state.standings).toEqual(expect.arrayContaining([
      expect.objectContaining({ editionEntryId: 'entry-aus', rank: 1, points: 2 }),
      expect.objectContaining({ editionEntryId: 'entry-nzl', rank: 2, points: 0 }),
    ]));
    expect(state.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'FINAL_SCORE', state: 'AVAILABLE' }),
      expect.objectContaining({ capability: 'PERIOD_SCORES', state: 'AVAILABLE' }),
    ]));
    expect(receipt.inserted).toBe(
      state.mutations.filter((mutation) => mutation.operation === 'INSERT').length,
    );
    expect(receipt.updated).toBe(
      state.mutations.filter((mutation) => mutation.operation === 'UPDATE').length,
    );
    const appliedRun = state.runs.find((run) => run.id === receipt.importRunId);
    expect(appliedRun?.metadata).toMatchObject({
      importKind: 'GLASGOW_RESULTS',
      sourceManifest: expect.objectContaining({ checksum: 'a'.repeat(64) }),
      mutationOperations: {
        INSERT: receipt.inserted,
        UPDATE: receipt.updated,
        DELETE: 0,
      },
    });
    expect(appliedRun?.startedAt).toBeInstanceOf(Date);
    expect(appliedRun?.completedAt).toBeInstanceOf(Date);
    expect((appliedRun?.completedAt as Date).getTime()).toBeGreaterThanOrEqual(
      (appliedRun?.startedAt as Date).getTime(),
    );

    const replayPreview = await service.recordPreview(input);
    const replay = await service.apply(input, replayPreview.preview.confirmationToken!);
    expect(replay).toMatchObject({
      inserted: 0,
      updated: 0,
      skipped: 1,
      replayOfImportRunId: receipt.importRunId,
    });

    const invalidCorrection = resultInput();
    invalidCorrection.results[0].sideAScore = 61;
    invalidCorrection.results[0].sourceUpdatedAt = '2026-07-25T11:01:00.000Z';
    invalidCorrection.results[0].periods![3].sideAScore = 16;
    const invalidCorrectionPreview = await service.preview(invalidCorrection);
    expect(invalidCorrectionPreview.valid).toBe(false);
    expect(invalidCorrectionPreview.issues).toContainEqual(
      expect.objectContaining({ code: 'CORRECTION_REQUIRED' }),
    );

    const correction = structuredClone(invalidCorrection);
    correction.sourceManifest.version = 'results-2026-07-25T11:02:00Z';
    correction.sourceManifest.checksum = 'b'.repeat(64);
    correction.results[0].resultQuality = 'CORRECTED';
    correction.correction = {
      reason: 'Official scorer corrected the fourth-quarter total',
      correctsImportChecksum: receipt.checksum,
    };
    const correctionPreview = await service.recordPreview(correction);
    const correctionReceipt = await service.apply(
      correction,
      correctionPreview.preview.confirmationToken!,
    );

    expect(state.matches.get('match-pool-1')).toMatchObject({
      status: 'COMPLETED',
      resultQuality: 'CORRECTED',
      homeScore: 61,
      awayScore: 50,
    });
    expect(correctionReceipt).toMatchObject({ inserted: 0, skipped: 0 });
    expect(correctionReceipt.updated).toBeGreaterThan(0);
  });

  it('applies a validated scheduled feed update without a manual dry-run receipt', async () => {
    const { prisma, state } = fakeResultsPrisma();
    const service = new GlasgowResultsImportService(prisma);
    const input = resultInput();

    const receipt = await service.applyScheduled(input);

    expect(state.matches.get('match-pool-1')).toMatchObject({
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      homeScore: 60,
      awayScore: 50,
    });
    expect(state.runs).not.toContainEqual(expect.objectContaining({ dryRun: true }));
    expect(state.runs.find((run) => run.id === receipt.importRunId)).toMatchObject({
      trigger: 'SCHEDULED',
      status: 'SUCCEEDED',
      dryRun: false,
      metadata: expect.objectContaining({
        importKind: 'GLASGOW_RESULTS',
        automated: true,
        recordedPreviewImportRunId: null,
      }),
    });
  });

  it('promotes a confirmed scheduled final without treating quality-only change as a correction', async () => {
    const { prisma, state } = fakeResultsPrisma();
    const service = new GlasgowResultsImportService(prisma);
    const first = resultInput();
    first.results[0].resultQuality = 'UNOFFICIAL_FINAL';

    await service.applyScheduled(first);

    const confirmed = structuredClone(first);
    confirmed.retrievedAt = '2026-07-25T11:00:30.000Z';
    confirmed.sourceManifest.checksum = 'b'.repeat(64);
    confirmed.sourceManifest.sources[0].retrievedAt = confirmed.retrievedAt;
    confirmed.results[0].resultQuality = 'OFFICIAL_FINAL';
    confirmed.results[0].sourceUpdatedAt = confirmed.retrievedAt;
    const receipt = await service.applyScheduled(confirmed);

    expect(state.matches.get('match-pool-1')).toMatchObject({
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      homeScore: 60,
      awayScore: 50,
    });
    expect(receipt.replayOfImportRunId).toBeNull();
    expect(state.runs.find((run) => run.id === receipt.importRunId)).toMatchObject({
      trigger: 'SCHEDULED',
      status: 'SUCCEEDED',
    });
  });
});
