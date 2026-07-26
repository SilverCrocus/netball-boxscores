import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficialFeedObservation } from '@/lib/glasgow/official-feed';
import {
  planOfficialGlasgowUpdates,
  syncOfficialGlasgowResults,
} from '@/lib/glasgow/official-feed-sync';

function observation(
  overrides: Partial<OfficialFeedObservation> = {},
): OfficialFeedObservation {
  return {
    provider: 'COMMONWEALTH_SPORT',
    providerCompetitionId: '3bb0d78e-d439-472a-a5bf-09b4e888aa04',
    providerMatchCode: 'NBLWTEAM7-------------GPB-000100--',
    providerSessionId: 'session-1',
    providerEventCode: 'TEAM7-------------',
    providerPhaseCode: 'GPB-',
    providerGenderCode: 'W',
    providerDisciplineCode: 'NBL',
    providerSideAResultId: 'result-a',
    providerSideBResultId: 'result-b',
    detailRequestUrl: 'https://api.commonwealthsport.com/details?id=session-1',
    startDate: '2026-07-26T08:00:00Z',
    endDate: '2026-07-26T09:30:00Z',
    status: 'LIVE',
    resultQuality: 'PROVISIONAL',
    sideAOrganisationCode: 'WAL',
    sideBOrganisationCode: 'SCO',
    sideAScore: 38,
    sideBScore: 48,
    ...overrides,
  };
}

function mappedMatch(overrides: Record<string, unknown> = {}) {
  return {
    externalId: '2026-07-26-0900-wal-sco',
    match: {
      id: 'match-1',
      scheduledAt: new Date('2026-07-26T08:00:00Z'),
      status: 'SCHEDULED' as const,
      resultQuality: 'UNKNOWN' as const,
      homeScore: 0,
      awayScore: 0,
      homeTeamId: 'team-wal',
      awayTeamId: 'team-sco',
      sourceUpdatedAt: null,
      ...overrides,
    },
  };
}

const teamMappings = new Map([
  ['WAL', 'team-wal'],
  ['SCO', 'team-sco'],
]);

describe('official Glasgow feed sync planning', () => {
  it('maps a live provider observation to the exact London-local fixture', () => {
    const plan = planOfficialGlasgowUpdates(
      [observation()],
      [mappedMatch()],
      teamMappings,
      new Date('2026-07-26T09:30:00Z'),
      null,
    );

    expect(plan.issues).toEqual([]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({
      matchId: 'match-1',
      result: {
        matchExternalId: '2026-07-26-0900-wal-sco',
        sideAExternalId: 'WAL',
        sideBExternalId: 'SCO',
        status: 'LIVE',
        resultQuality: 'PROVISIONAL',
        sideAScore: 38,
        sideBScore: 48,
      },
    });
  });

  it('requires two identical completed snapshots before official promotion', () => {
    const final = observation({
      status: 'COMPLETED',
      resultQuality: 'OFFICIAL_FINAL',
      sideAScore: 52,
      sideBScore: 61,
    });
    const first = planOfficialGlasgowUpdates(
      [final],
      [mappedMatch()],
      teamMappings,
      new Date('2026-07-26T10:00:00Z'),
      null,
    );
    const second = planOfficialGlasgowUpdates(
      [final],
      [mappedMatch({
        status: 'COMPLETED',
        resultQuality: 'UNOFFICIAL_FINAL',
        homeScore: 52,
        awayScore: 61,
      })],
      teamMappings,
      new Date('2026-07-26T10:00:30Z'),
      'a'.repeat(64),
    );

    expect(first.updates[0].result.resultQuality).toBe('UNOFFICIAL_FINAL');
    expect(second.updates[0].result.resultQuality).toBe('OFFICIAL_FINAL');
  });

  it('maps Commonwealth organisation codes onto the governed bundle team IDs', () => {
    const plan = planOfficialGlasgowUpdates(
      [observation({
        sideAOrganisationCode: 'TGA',
        sideBOrganisationCode: 'MAW',
      })],
      [mappedMatch({
        homeTeamId: 'team-ton',
        awayTeamId: 'team-mwi',
      })],
      new Map([
        ['TON', 'team-ton'],
        ['MWI', 'team-mwi'],
      ]),
      new Date('2026-07-26T09:30:00Z'),
      null,
    );

    expect(plan.issues).toEqual([]);
    expect(plan.updates[0].result).toMatchObject({
      sideAExternalId: 'TON',
      sideBExternalId: 'MWI',
    });
  });

  it('quarantines a completed-score correction without a prior receipt', () => {
    const plan = planOfficialGlasgowUpdates(
      [observation({
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        sideAScore: 53,
        sideBScore: 60,
      })],
      [mappedMatch({
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        homeScore: 52,
        awayScore: 61,
      })],
      teamMappings,
      new Date('2026-07-26T10:30:00Z'),
      null,
    );

    expect(plan.updates).toEqual([]);
    expect(plan.issues).toContain(
      'A provider correction was quarantined because no prior results checksum exists',
    );
  });

  it('rejects participant conflicts and live score regressions', () => {
    const participantConflict = planOfficialGlasgowUpdates(
      [observation()],
      [mappedMatch({ homeTeamId: 'different-team' })],
      teamMappings,
      new Date('2026-07-26T09:30:00Z'),
      null,
    );
    const regression = planOfficialGlasgowUpdates(
      [observation({ sideAScore: 37 })],
      [mappedMatch({
        status: 'LIVE',
        resultQuality: 'PROVISIONAL',
        homeScore: 38,
        awayScore: 48,
      })],
      teamMappings,
      new Date('2026-07-26T09:30:00Z'),
      null,
    );

    expect(participantConflict.updates).toEqual([]);
    expect(participantConflict.issues[0]).toContain('conflicts with the scheduled participants');
    expect(regression.updates).toEqual([]);
    expect(regression.issues[0]).toContain('live score regression');
  });

  it('never reopens a completed fixture from a provisional provider hand-off', () => {
    const plan = planOfficialGlasgowUpdates(
      [observation({
        status: 'LIVE',
        resultQuality: 'PROVISIONAL',
        sideAScore: 52,
        sideBScore: 61,
      })],
      [mappedMatch({
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        homeScore: 52,
        awayScore: 61,
      })],
      teamMappings,
      new Date('2026-07-26T10:30:00Z'),
      'a'.repeat(64),
    );

    expect(plan.updates).toEqual([]);
    expect(plan.issues).toEqual([
      expect.stringContaining('attempted to reopen a completed fixture'),
    ]);
  });

  it('quarantines every observation involved in provider or fixture collisions', () => {
    const duplicateProvider = planOfficialGlasgowUpdates(
      [observation(), observation({ sideAScore: 39 })],
      [mappedMatch()],
      teamMappings,
      new Date('2026-07-26T09:30:00Z'),
      null,
    );
    const duplicateFixture = planOfficialGlasgowUpdates(
      [
        observation(),
        observation({
          providerMatchCode: 'different-provider-match',
          sideAScore: 39,
        }),
      ],
      [mappedMatch()],
      teamMappings,
      new Date('2026-07-26T09:30:00Z'),
      null,
    );

    expect(duplicateProvider.updates).toEqual([]);
    expect(duplicateProvider.issues).toHaveLength(1);
    expect(duplicateFixture.updates).toEqual([]);
    expect(duplicateFixture.issues).toHaveLength(1);
  });
});

describe('official Glasgow feed sync workflow', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fetches the backfill window, applies through the scheduled importer, and broadcasts', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    vi.stubEnv(
      'GLASGOW_LIVE_FEED_BASE_URL',
      'https://api.commonwealthsport.com/cwg-schedule/v1/cwg',
    );
    const current = mappedMatch().match;
    const applied = {
      id: current.id,
      status: 'LIVE' as const,
      homeScore: 38,
      awayScore: 48,
      currentQuarter: null,
      currentTime: null,
      sourceUpdatedAt: new Date('2026-07-26T09:30:00Z'),
    };
    const findManyMatches = vi.fn()
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([applied]);
    const db = {
      competition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'glasgow-edition',
          publicationStatus: 'PUBLISHED',
        }),
      },
      sourceSystem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'glasgow-source', active: true }),
      },
      editionSource: {
        findFirst: vi.fn().mockResolvedValue({ id: 'edition-source' }),
      },
      sourceEntityMapping: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityType: 'MATCH',
            externalId: '2026-07-26-0900-wal-sco',
            internalEntityId: 'match-1',
          },
          { entityType: 'TEAM', externalId: 'WAL', internalEntityId: 'team-wal' },
          { entityType: 'TEAM', externalId: 'SCO', internalEntityId: 'team-sco' },
        ]),
      },
      match: { findMany: findManyMatches },
      importRun: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const fetchForDate = vi.fn(async (date: string) =>
      date === '2026-07-26' ? [observation()] : []);
    const applyScheduled = vi.fn().mockResolvedValue({
      importRunId: 'run-1',
      checksum: 'b'.repeat(64),
      inserted: 0,
      updated: 3,
      skipped: 0,
      replayOfImportRunId: null,
    });
    const broadcast = vi.fn().mockResolvedValue(undefined);

    const result = await syncOfficialGlasgowResults({
      prisma: db,
      now: () => new Date('2026-07-26T09:30:00Z'),
      fetchForDate,
      applyScheduled,
      broadcast,
    });

    expect(result).toEqual({
      status: 'success',
      matchesProcessed: 1,
      issues: [],
    });
    expect(fetchForDate.mock.calls.map(([date]) => date)).toEqual([
      '2026-07-25',
      '2026-07-26',
    ]);
    expect(applyScheduled).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      edition: 'glasgow-2026',
      sourceKey: 'glasgow-2026-public-data',
      results: [expect.objectContaining({
        matchExternalId: '2026-07-26-0900-wal-sco',
        status: 'LIVE',
      })],
      sourceManifest: expect.objectContaining({
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        normalizedArtifact: [
          expect.objectContaining({
            providerMatchCode: 'NBLWTEAM7-------------GPB-000100--',
            providerSideAResultId: 'result-a',
            providerSideBResultId: 'result-b',
          }),
        ],
      }),
    }));
    expect(broadcast).toHaveBeenCalledWith(applied);
  });

  it('quarantines one rejected result without rolling back another safe score', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    vi.stubEnv(
      'GLASGOW_LIVE_FEED_BASE_URL',
      'https://api.commonwealthsport.com/cwg-schedule/v1/cwg',
    );
    const first = mappedMatch().match;
    const second = {
      ...mappedMatch({
        id: 'match-2',
        scheduledAt: new Date('2026-07-26T10:00:00Z'),
        homeTeamId: 'team-aus',
        awayTeamId: 'team-eng',
      }).match,
    };
    const appliedSecond = {
      id: 'match-2',
      status: 'LIVE' as const,
      homeScore: 12,
      awayScore: 10,
      currentQuarter: null,
      currentTime: null,
      sourceUpdatedAt: new Date('2026-07-26T11:00:00Z'),
    };
    const db = {
      competition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'glasgow-edition',
          publicationStatus: 'PUBLISHED',
        }),
      },
      sourceSystem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'glasgow-source', active: true }),
      },
      editionSource: {
        findFirst: vi.fn().mockResolvedValue({ id: 'edition-source' }),
      },
      sourceEntityMapping: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityType: 'MATCH',
            externalId: '2026-07-26-0900-wal-sco',
            internalEntityId: 'match-1',
          },
          {
            entityType: 'MATCH',
            externalId: '2026-07-26-1100-aus-eng',
            internalEntityId: 'match-2',
          },
          { entityType: 'TEAM', externalId: 'WAL', internalEntityId: 'team-wal' },
          { entityType: 'TEAM', externalId: 'SCO', internalEntityId: 'team-sco' },
          { entityType: 'TEAM', externalId: 'AUS', internalEntityId: 'team-aus' },
          { entityType: 'TEAM', externalId: 'ENG', internalEntityId: 'team-eng' },
        ]),
      },
      match: {
        findMany: vi.fn()
          .mockResolvedValueOnce([first, second])
          .mockResolvedValueOnce([appliedSecond]),
      },
      importRun: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const secondObservation = observation({
      providerMatchCode: 'provider-match-2',
      providerSessionId: 'session-2',
      providerSideAResultId: 'result-2-a',
      providerSideBResultId: 'result-2-b',
      detailRequestUrl: 'https://api.commonwealthsport.com/details?id=session-2',
      startDate: '2026-07-26T10:00:00Z',
      endDate: '2026-07-26T11:30:00Z',
      sideAOrganisationCode: 'AUS',
      sideBOrganisationCode: 'ENG',
      sideAScore: 12,
      sideBScore: 10,
    });
    const applyScheduled = vi.fn()
      .mockRejectedValueOnce(new Error('dependent match has already started'))
      .mockResolvedValueOnce({
        importRunId: 'run-2',
        checksum: 'c'.repeat(64),
        inserted: 0,
        updated: 3,
        skipped: 0,
        replayOfImportRunId: null,
      });
    const broadcast = vi.fn().mockResolvedValue(undefined);

    const result = await syncOfficialGlasgowResults({
      prisma: db,
      now: () => new Date('2026-07-26T11:00:00Z'),
      fetchForDate: vi.fn(async (date: string) =>
        date === '2026-07-26' ? [observation(), secondObservation] : []),
      applyScheduled,
      broadcast,
    });

    expect(result).toMatchObject({
      status: 'partial',
      matchesProcessed: 1,
      issues: [expect.stringContaining('dependent match has already started')],
    });
    expect(applyScheduled).toHaveBeenCalledTimes(2);
    expect(applyScheduled.mock.calls[0][0].results).toHaveLength(1);
    expect(applyScheduled.mock.calls[1][0].results).toHaveLength(1);
    expect(broadcast).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith(appliedSecond);
  });

  it('periodically revisits elapsed tournament dates for late official corrections', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    vi.stubEnv(
      'GLASGOW_LIVE_FEED_BASE_URL',
      'https://api.commonwealthsport.com/cwg-schedule/v1/cwg',
    );
    const oldMapping = {
      ...mappedMatch({
        scheduledAt: new Date('2026-07-25T08:00:00Z'),
        status: 'COMPLETED',
        resultQuality: 'OFFICIAL_FINAL',
        homeScore: 52,
        awayScore: 61,
      }),
      externalId: '2026-07-25-0900-wal-sco',
    };
    const db = {
      competition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'glasgow-edition',
          publicationStatus: 'PUBLISHED',
        }),
      },
      sourceSystem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'glasgow-source', active: true }),
      },
      editionSource: {
        findFirst: vi.fn().mockResolvedValue({ id: 'edition-source' }),
      },
      sourceEntityMapping: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityType: 'MATCH',
            externalId: oldMapping.externalId,
            internalEntityId: oldMapping.match.id,
          },
          { entityType: 'TEAM', externalId: 'WAL', internalEntityId: 'team-wal' },
          { entityType: 'TEAM', externalId: 'SCO', internalEntityId: 'team-sco' },
        ]),
      },
      match: { findMany: vi.fn().mockResolvedValue([oldMapping.match]) },
      importRun: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const fetchForDate = vi.fn().mockResolvedValue([]);

    const result = await syncOfficialGlasgowResults({
      prisma: db,
      now: () => new Date('2026-07-28T09:30:00Z'),
      fetchForDate,
      historicalCorrectionSweepDue: true,
    });

    expect(result).toEqual({
      status: 'empty',
      matchesProcessed: 0,
      issues: [],
    });
    expect(fetchForDate.mock.calls.map(([date]) => date)).toEqual([
      '2026-07-25',
      '2026-07-27',
      '2026-07-28',
    ]);
  });

  it.each([
    {
      label: 'live match',
      status: 'LIVE',
      resultQuality: 'PROVISIONAL',
    },
    {
      label: 'unconfirmed final',
      status: 'COMPLETED',
      resultQuality: 'UNOFFICIAL_FINAL',
    },
  ])('reports missing $label coverage from a successful feed date', async ({
    status,
    resultQuality,
  }) => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    vi.stubEnv(
      'GLASGOW_LIVE_FEED_BASE_URL',
      'https://api.commonwealthsport.com/cwg-schedule/v1/cwg',
    );
    const current = mappedMatch({ status, resultQuality }).match;
    const db = {
      competition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'glasgow-edition',
          publicationStatus: 'PUBLISHED',
        }),
      },
      sourceSystem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'glasgow-source', active: true }),
      },
      editionSource: {
        findFirst: vi.fn().mockResolvedValue({ id: 'edition-source' }),
      },
      sourceEntityMapping: {
        findMany: vi.fn().mockResolvedValue([
          {
            entityType: 'MATCH',
            externalId: '2026-07-26-0900-wal-sco',
            internalEntityId: 'match-1',
          },
          { entityType: 'TEAM', externalId: 'WAL', internalEntityId: 'team-wal' },
          { entityType: 'TEAM', externalId: 'SCO', internalEntityId: 'team-sco' },
        ]),
      },
      match: { findMany: vi.fn().mockResolvedValue([current]) },
      importRun: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await syncOfficialGlasgowResults({
      prisma: db,
      now: () => new Date('2026-07-26T09:30:00Z'),
      fetchForDate: vi.fn().mockResolvedValue([]),
      historicalCorrectionSweepDue: false,
    });

    expect(result).toEqual({
      status: 'partial',
      matchesProcessed: 0,
      issues: [
        'Expected exactly one official observation for tracked fixture '
          + '2026-07-26-0900-wal-sco; received 0',
      ],
    });
  });

  it('quarantines a mapping ID even when it is duplicated three times', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'true');
    vi.stubEnv(
      'GLASGOW_LIVE_FEED_BASE_URL',
      'https://api.commonwealthsport.com/cwg-schedule/v1/cwg',
    );
    const duplicate = '2026-07-26-0900-wal-sco';
    const db = {
      competition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'glasgow-edition',
          publicationStatus: 'PUBLISHED',
        }),
      },
      sourceSystem: {
        findUnique: vi.fn().mockResolvedValue({ id: 'glasgow-source', active: true }),
      },
      editionSource: {
        findFirst: vi.fn().mockResolvedValue({ id: 'edition-source' }),
      },
      sourceEntityMapping: {
        findMany: vi.fn().mockResolvedValue([
          { entityType: 'MATCH', externalId: duplicate, internalEntityId: 'match-1' },
          { entityType: 'MATCH', externalId: duplicate, internalEntityId: 'match-2' },
          { entityType: 'MATCH', externalId: duplicate, internalEntityId: 'match-3' },
          { entityType: 'TEAM', externalId: 'WAL', internalEntityId: 'team-wal' },
          { entityType: 'TEAM', externalId: 'SCO', internalEntityId: 'team-sco' },
        ]),
      },
    } as unknown as PrismaClient;
    const fetchForDate = vi.fn();

    const result = await syncOfficialGlasgowResults({
      prisma: db,
      fetchForDate,
    });

    expect(result.status).toBe('error');
    expect(result.issues).toEqual([
      `Match mapping ${duplicate} is duplicated`,
      'Glasgow source mappings are incomplete',
    ]);
    expect(fetchForDate).not.toHaveBeenCalled();
  });

  it('is inert when the feed switch is disabled', async () => {
    vi.stubEnv('GLASGOW_LIVE_FEED_ENABLED', 'false');
    const result = await syncOfficialGlasgowResults();
    expect(result).toEqual({ status: 'empty', matchesProcessed: 0, issues: [] });
  });
});
