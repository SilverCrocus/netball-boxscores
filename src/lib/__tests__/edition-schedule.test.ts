import { describe, expect, it } from 'vitest';
import {
  buildEditionSchedule,
  type EditionScheduleMatchRecord,
} from '@/lib/edition-schedule';

const AUSTRALIA = {
  id: 'aus',
  name: 'Australia',
  slug: 'australia',
  abbreviation: 'AUS',
  logoUrl: null,
};

const ENGLAND = {
  id: 'eng',
  name: 'England',
  slug: 'england',
  abbreviation: 'ENG',
  logoUrl: null,
};

interface MatchFactoryInput {
  id: string;
  scheduledAt?: string;
  status?: EditionScheduleMatchRecord['status'];
  resultQuality?: EditionScheduleMatchRecord['resultQuality'];
  homeScore?: number;
  awayScore?: number;
  stage?: EditionScheduleMatchRecord['stage'];
  stageGroup?: EditionScheduleMatchRecord['stageGroup'];
  resolved?: boolean;
  sideALabel?: string;
  sideBLabel?: string;
}

function matchRecord({
  id,
  scheduledAt = '2026-07-25T08:00:00.000Z',
  status = 'SCHEDULED',
  resultQuality = status === 'COMPLETED' ? 'OFFICIAL_FINAL' : 'UNKNOWN',
  homeScore = 0,
  awayScore = 0,
  stage = {
    id: 'pool-stage',
    slug: 'pool-stage',
    name: 'Pool Stage',
    type: 'POOL',
    sequence: 1,
  },
  stageGroup = {
    id: 'pool-a',
    slug: 'pool-a',
    name: 'Pool A',
    sequence: 1,
  },
  resolved = true,
  sideALabel = '11th place after pool stage',
  sideBLabel = '12th place after pool stage',
}: MatchFactoryInput): EditionScheduleMatchRecord {
  return {
    id,
    scheduledAt: new Date(scheduledAt),
    status,
    resultQuality,
    homeScore,
    awayScore,
    venue: 'The Hydro',
    neutralVenue: true,
    round: null,
    roundLabel: stage?.name ?? 'Fixture',
    finalCode: null,
    homeTeam: resolved ? AUSTRALIA : null,
    awayTeam: resolved ? ENGLAND : null,
    stage,
    stageGroup,
    dataCoverage: [],
    slots: resolved
      ? [
          {
            side: 'A',
            sourceLabel: null,
            resolvedEntry: { displayName: 'Australia', team: AUSTRALIA },
          },
          {
            side: 'B',
            sourceLabel: null,
            resolvedEntry: { displayName: 'England', team: ENGLAND },
          },
        ]
      : [
          { side: 'A', sourceLabel: sideALabel, resolvedEntry: null },
          { side: 'B', sourceLabel: sideBLabel, resolvedEntry: null },
        ],
  } as EditionScheduleMatchRecord;
}

const GLASGOW_EDITION = {
  id: 'glasgow-2026',
  competitionName: 'Commonwealth Games Netball',
  editionLabel: 'Glasgow 2026',
  competitionKind: 'TOURNAMENT' as const,
  sourceTimezone: 'Europe/London',
  teamCount: 12,
  editionCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE' }] as const,
};

describe('buildEditionSchedule', () => {
  it('renders Glasgow times in Sydney while preserving the source timezone and unresolved labels', () => {
    const schedule = buildEditionSchedule(GLASGOW_EDITION, [matchRecord({
      id: 'classification-11-12',
      resolved: false,
      stage: {
        id: 'classification',
        slug: 'classification',
        name: 'Classification',
        type: 'CLASSIFICATION',
        sequence: 2,
      },
      stageGroup: null,
      sideALabel: '11th place after pool stage',
      sideBLabel: '12th place after pool stage',
    })]);

    const fixture = schedule.stages[0].dates[0].fixtures[0];
    expect(schedule.sourceTimezone).toBe('Europe/London');
    expect(schedule.displayTimezone).toBe('Australia/Sydney');
    expect(schedule.timezoneLabel).toBe('AEST');
    expect(fixture.localTimeLabel).toBe('18:00 AEST');
    expect(fixture.localDateLabel).toBe('Saturday, 25 July 2026');
    expect(fixture.sideA.displayName).toBe('11th place after pool stage');
    expect(fixture.sideB.displayName).toBe('12th place after pool stage');
    expect(fixture.href).toBeNull();
    expect(fixture.score).toBeNull();
    expect(JSON.stringify(fixture)).not.toContain('TBC');
  });

  it('normalizes timestamps rehydrated from the Next server cache', () => {
    const cachedRecord = {
      ...matchRecord({ id: 'cached-pool-match' }),
      scheduledAt: '2026-07-25T08:00:00.000Z',
    };

    const schedule = buildEditionSchedule(GLASGOW_EDITION, [cachedRecord]);
    const fixture = schedule.stages[0].dates[0].fixtures[0];

    expect(fixture.scheduledAt).toBeInstanceOf(Date);
    expect(fixture.localTimeLabel).toBe('18:00 AEST');
  });

  it('groups late Glasgow fixtures by the following Sydney calendar date', () => {
    const schedule = buildEditionSchedule(GLASGOW_EDITION, [matchRecord({
      id: 'late-glasgow-fixture',
      scheduledAt: '2026-08-02T20:00:00.000Z',
    })]);

    expect(schedule.summary.dateRangeLabel).toBe('3 Aug 2026');
    expect(schedule.stages[0].dates[0]).toMatchObject({
      key: '2026-08-03',
      label: 'Monday, 3 August 2026',
    });
    expect(schedule.stages[0].dates[0].fixtures[0].localTimeLabel).toBe('06:00 AEST');
  });

  it('expands a source TBC marker without creating a dummy team identity', () => {
    const schedule = buildEditionSchedule(GLASGOW_EDITION, [matchRecord({
      id: 'semi-final-one',
      resolved: false,
      stage: { id: 'semis', slug: 'semi-finals', name: 'Semi-finals', type: 'SEMI_FINALS', sequence: 3 },
      stageGroup: null,
      sideALabel: 'Semi-finalist TBC',
      sideBLabel: 'Semi-finalist TBC',
    })]);

    const fixture = schedule.stages[0].dates[0].fixtures[0];
    expect(fixture.sideA).toMatchObject({
      displayName: 'Semi-finalist to be confirmed',
      team: null,
      resolved: false,
    });
    expect(fixture.sideB.displayName).toBe('Semi-finalist to be confirmed');
  });

  it('groups the complete 38-match Glasgow programme by official stage and venue date', () => {
    const stagePlan = [
      { count: 30, id: 'pool-stage', slug: 'pool-stage', name: 'Pool Stage', type: 'POOL' as const, sequence: 1 },
      { count: 4, id: 'classification', slug: 'classification', name: 'Classification', type: 'CLASSIFICATION' as const, sequence: 2 },
      { count: 2, id: 'semi-finals', slug: 'semi-finals', name: 'Semi-finals', type: 'SEMI_FINALS' as const, sequence: 3 },
      { count: 2, id: 'medal-matches', slug: 'medal-matches', name: 'Medal Matches', type: 'MEDAL_MATCHES' as const, sequence: 4 },
    ];
    const records = stagePlan.flatMap((stage) => Array.from({ length: stage.count }, (_, index) =>
      matchRecord({
        id: `${stage.id}-${index + 1}`,
        scheduledAt: new Date(Date.UTC(2026, 6, 25 + stage.sequence, 8 + (index % 4))).toISOString(),
        stage,
        stageGroup: stage.type === 'POOL'
          ? { id: index % 2 ? 'pool-b' : 'pool-a', slug: index % 2 ? 'pool-b' : 'pool-a', name: index % 2 ? 'Pool B' : 'Pool A', sequence: index % 2 ? 2 : 1 }
          : null,
        resolved: stage.type === 'POOL',
        sideALabel: stage.type === 'MEDAL_MATCHES' ? 'Winner of Semi-final 1' : 'Qualifier A',
        sideBLabel: stage.type === 'MEDAL_MATCHES' ? 'Winner of Semi-final 2' : 'Qualifier B',
      })
    ));

    const schedule = buildEditionSchedule(GLASGOW_EDITION, records);

    expect(schedule.summary).toMatchObject({
      fixtureCount: 38,
      teamCount: 12,
      stageCount: 4,
      scheduledCount: 38,
    });
    expect(schedule.stages.map((stage) => [stage.name, stage.fixtureCount])).toEqual([
      ['Pool Stage', 30],
      ['Classification', 4],
      ['Semi-finals', 2],
      ['Medal Matches', 2],
    ]);
    expect(schedule.stages.flatMap((stage) => stage.dates.flatMap((date) => date.fixtures))).toHaveLength(38);
  });

  it('produces a useful league schedule and only reveals real live or final scores', () => {
    const records = [
      matchRecord({
        id: 'round-one',
        scheduledAt: '2026-04-04T08:00:00.000Z',
        stage: { id: 'regular', slug: 'regular-season', name: 'Regular Season', type: 'REGULAR_SEASON', sequence: 1 },
        stageGroup: null,
      }),
      matchRecord({
        id: 'grand-final',
        scheduledAt: '2026-07-04T09:30:00.000Z',
        status: 'COMPLETED',
        homeScore: 61,
        awayScore: 40,
        stage: { id: 'finals', slug: 'finals', name: 'Finals', type: 'FINALS', sequence: 2 },
        stageGroup: null,
      }),
    ];
    const schedule = buildEditionSchedule({
      id: 'ssn-2026',
      competitionName: 'Suncorp Super Netball',
      editionLabel: '2026',
      competitionKind: 'LEAGUE',
      sourceTimezone: 'Australia/Sydney',
      teamCount: 8,
      editionCoverage: [{ capability: 'FINAL_SCORE', state: 'AVAILABLE' }],
    }, records);

    const [scheduled, completed] = schedule.stages.flatMap((stage) =>
      stage.dates.flatMap((date) => date.fixtures)
    );
    expect(schedule.summary).toMatchObject({ fixtureCount: 2, teamCount: 8, stageCount: 2, completedCount: 1 });
    expect(schedule.timezoneLabel).toBe('Australia/Sydney');
    expect(scheduled.score).toBeNull();
    expect(completed.score).toEqual({ sideA: 61, sideB: 40 });
    expect(completed.href).toBe('/match/grand-final?edition=ssn-2026');
  });

  it('labels an unknown-quality completed row as pending and hides its zero defaults', () => {
    const schedule = buildEditionSchedule({
      ...GLASGOW_EDITION,
      editionCoverage: [{ capability: 'FINAL_SCORE', state: 'AVAILABLE' }],
    }, [matchRecord({
      id: 'pending-result',
      status: 'COMPLETED',
      resultQuality: 'UNKNOWN',
    })]);

    const fixture = schedule.stages[0].dates[0].fixtures[0];
    expect(fixture.statusLabel).toBe('Result pending');
    expect(fixture.score).toBeNull();
  });
});
