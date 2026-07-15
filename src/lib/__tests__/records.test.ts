import { describe, expect, it } from 'vitest';
import type { AnalyticsFact } from '@/lib/analytics';
import { calculateRecordSnapshot, reconcileRecordHistory } from '@/lib/records';
import type { RecordCandidate, StoredRecordEntry } from '@/lib/records';

function fact(entityId: string, matchId: string, goals: number, overrides: Partial<AnalyticsFact> = {}): AnalyticsFact {
  return {
    entityType: 'PLAYER',
    entityId,
    matchId,
    competitionId: 'edition-1',
    competitionSeriesId: 'series-1',
    competitionKind: 'LEAGUE',
    stageId: 'regular',
    scheduledAt: new Date(`2026-05-${matchId.padStart(2, '0')}T10:00:00Z`),
    sourceUpdatedAt: null,
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    isSimulation: false,
    capabilities: { PLAYER_BOX_SCORE: 'AVAILABLE' },
    stats: { minutesPlayed: 60, goals, attempts: goals + 2 },
    ...overrides,
  };
}

const entities = [
  { id: 'one', name: 'Player One', position: 'GS' },
  { id: 'two', name: 'Player Two', position: 'GS' },
];

describe('record snapshots', () => {
  it('builds auditable single-match records without claiming all-time coverage', () => {
    const snapshot = calculateRecordSnapshot([
      fact('one', '01', 50),
      fact('two', '02', 60),
    ], entities, {
      scope: 'SINGLE_MATCH',
      metricId: 'goals',
      aggregation: 'TOTAL',
      entityType: 'PLAYER',
      competitionId: 'edition-1',
      competitionLabel: 'SSN 2026',
      coverageStart: new Date('2026-01-01T00:00:00Z'),
    });
    expect(snapshot.entries[0]).toMatchObject({
      value: 60,
      entity: { id: 'two' },
      supportingMatchId: '02',
      status: 'CONFIRMED',
      formulaVersion: 'goals.v1',
    });
    expect(snapshot.coverageLabel).toBe('Highest recorded by CentrePass in SSN 2026');
    expect(snapshot.coverageLabel.toLocaleLowerCase()).not.toContain('all-time');
    expect(snapshot.entries[0].source.policy).toContain('official-final/corrected');
  });

  it('supports finals and cross-edition career scopes through the same metric catalogue', () => {
    const facts = [
      fact('one', '01', 50),
      fact('one', '02', 30, { stageId: 'finals' }),
      fact('two', '03', 40, { competitionId: 'edition-2' }),
    ];
    const finals = calculateRecordSnapshot(facts, entities, {
      scope: 'FINALS',
      metricId: 'goals',
      aggregation: 'TOTAL',
      entityType: 'PLAYER',
      competitionId: 'edition-1',
      competitionLabel: 'SSN 2026',
      finalsStageIds: ['finals'],
      coverageStart: new Date('2026-01-01T00:00:00Z'),
    });
    expect(finals.entries[0]).toMatchObject({ entity: { id: 'one' }, value: 30, games: 1 });

    const career = calculateRecordSnapshot(facts, entities, {
      scope: 'CAREER',
      metricId: 'goals',
      aggregation: 'TOTAL',
      entityType: 'PLAYER',
      coverageStart: new Date('2025-01-01T00:00:00Z'),
    });
    expect(career.entries[0]).toMatchObject({ entity: { id: 'one' }, value: 80, games: 2 });
    expect(career.coverageLabel).toContain('since 2025-01-01');
  });

  it('fails closed for unavailable source coverage', () => {
    const snapshot = calculateRecordSnapshot([
      fact('one', '01', 99, { capabilities: { PLAYER_BOX_SCORE: 'UNAVAILABLE' } }),
    ], entities, {
      scope: 'EDITION',
      metricId: 'goals',
      aggregation: 'TOTAL',
      entityType: 'PLAYER',
      competitionId: 'edition-1',
      coverageStart: new Date('2026-01-01T00:00:00Z'),
    });
    expect(snapshot.entries).toEqual([]);
  });
});

describe('record history reconciliation', () => {
  function candidate(value: number): RecordCandidate {
    return {
      recordType: 'EDITION', metricId: 'goals', entityType: 'PLAYER',
      entity: { id: 'one', name: 'Player One' }, competitionId: 'edition-1',
      scopeKey: 'scope-key', scope: {}, value, unit: 'COUNT', games: 2, minutes: 120,
      achievedAt: '2026-05-02T10:00:00.000Z', supportingMatchId: null,
      supportingCompetitionId: 'edition-1', formulaVersion: 'goals.v1',
      methodVersion: 'centrepass-records.v1', coverage: 'AVAILABLE',
      coverageLabel: 'Highest recorded by CentrePass in SSN 2026', includedMatchIds: ['01', '02'],
      source: { policy: 'official', note: 'test' }, status: 'CONFIRMED', supersedesId: null,
    };
  }

  it('supersedes corrected values without deleting audit history', () => {
    const previous: StoredRecordEntry = { ...candidate(100), id: 7 };
    const corrected = candidate(98);
    const group = 'EDITION|goals|PLAYER|scope-key';
    const result = reconcileRecordHistory([previous], [corrected], new Set([group]));
    expect(result.superseded).toEqual([expect.objectContaining({ id: 7, status: 'SUPERSEDED', value: 100 })]);
    expect(result.inserts).toEqual([expect.objectContaining({ status: 'CORRECTED', value: 98, supersedesId: 7 })]);
  });
});

