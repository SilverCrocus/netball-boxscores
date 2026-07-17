import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  resolvePublicMatchAccessBatch: vi.fn(),
  canExposePublicMatchScore: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    stage: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
  },
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: mocks.resolvePublicMatchAccessBatch,
  canExposePublicMatchScore: mocks.canExposePublicMatchScore,
}));

import {
  getTournamentBracket,
  getTournamentPools,
  getTournamentPoolStandings,
  projectBracketMatch,
} from '@/lib/tournament/service';

function entry(seed: number, pool: 'a' | 'b') {
  const abbreviation = `${pool.toUpperCase()}${seed}`;
  return {
    id: `entry-${pool}-${seed}`,
    seed,
    displayName: null,
    team: {
      id: `team-${pool}-${seed}`,
      name: `Team ${abbreviation}`,
      slug: `team-${pool}-${seed}`,
      abbreviation,
      logoUrl: null,
    },
  };
}

function group(pool: 'a' | 'b') {
  return {
    id: `pool-${pool}`,
    slug: `pool-${pool}`,
    name: `Pool ${pool.toUpperCase()}`,
    sequence: pool === 'a' ? 1 : 2,
    primaryEntries: Array.from({ length: 6 }, (_, index) => entry(index + 1, pool)),
  };
}

function bracketMatch(id: string) {
  return {
    id,
    round: null,
    roundLabel: 'Finals fixture',
    finalCode: null,
    scheduledAt: new Date('2026-08-01T08:00:00.000Z'),
    venue: 'The Hydro',
    status: 'COMPLETED',
    homeScore: 61,
    awayScore: 60,
    homeTeam: { id: 'aus', name: 'Australia', abbreviation: 'AUS', logoUrl: null },
    awayTeam: { id: 'jam', name: 'Jamaica', abbreviation: 'JAM', logoUrl: null },
    slots: [],
  };
}

describe('tournament data service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePublicMatchAccessBatch.mockImplementation(async (ids: string[]) => new Map(
      ids.map((id) => [id, { scoreAvailable: true }]),
    ));
    mocks.canExposePublicMatchScore.mockImplementation(
      (access: { scoreAvailable: boolean }) => access.scoreAvailable,
    );
  });

  it('loads six canonical entries for each published Glasgow pool', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'pool-stage',
      name: 'Pool Stage',
      groups: [group('a'), group('b')],
    });

    const overview = await getTournamentPools('glasgow-2026');

    expect(overview?.participantCount).toBe(12);
    expect(overview?.pools).toHaveLength(2);
    expect(overview?.pools[0].teams).toHaveLength(6);
    expect(overview?.pools[1].teams).toHaveLength(6);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        competitionId: 'glasgow-2026',
        type: 'POOL',
        isPublished: true,
      },
    }));
  });

  it('uses StageStanding rows when official pool standings exist', async () => {
    const pool = group('a');
    mocks.findFirst.mockResolvedValue({
      id: 'pool-stage',
      name: 'Pool Stage',
      groups: [{
        ...pool,
        standings: [{
          id: 'standing-2',
          editionEntryId: 'entry-a-2',
          rank: 1,
          played: 3,
          wins: 3,
          losses: 0,
          draws: 0,
          goalsFor: 180,
          goalsAgainst: 132,
          goalPercentage: 136.4,
          points: 6,
        }],
      }],
    });

    const overview = await getTournamentPoolStandings('glasgow-2026');

    expect(overview?.hasAnyStandings).toBe(true);
    expect(overview?.pools[0].rows[0]).toMatchObject({
      entryId: 'entry-a-2',
      standing: {
        rank: 1,
        played: 3,
        wins: 3,
        points: 6,
      },
    });
    expect(overview?.pools[0].rows[1].standing).toBeNull();
  });

  it('keeps pre-event statistics absent instead of manufacturing zero rows', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'pool-stage',
      name: 'Pool Stage',
      groups: [{ ...group('a'), standings: [] }],
    });

    const overview = await getTournamentPoolStandings('glasgow-2026');

    expect(overview?.hasAnyStandings).toBe(false);
    expect(overview?.pools[0].hasStandings).toBe(false);
    expect(overview?.pools[0].rows.every((row) => row.standing === null)).toBe(true);
  });

  it('projects unresolved source labels and hides scheduled zero score defaults', () => {
    const projected = projectBracketMatch({
      id: 'gold-medal',
      round: null,
      roundLabel: 'Gold medal match',
      finalCode: null,
      scheduledAt: new Date('2026-08-02T12:00:00.000Z'),
      venue: 'The Hydro',
      status: 'SCHEDULED',
      scoreAvailable: false,
      homeScore: 0,
      awayScore: 0,
      homeTeam: null,
      awayTeam: null,
      slots: [
        {
          side: 'A',
          sourceLabel: 'Winner of Semi-final 1',
          resolvedEntry: null,
        },
        {
          side: 'B',
          sourceLabel: 'Winner of Semi-final 2',
          resolvedEntry: null,
        },
      ],
    }, 'Medal Matches');

    expect(projected.sideA).toMatchObject({
      label: 'Winner of Semi-final 1',
      resolved: false,
      team: null,
      score: null,
    });
    expect(projected.sideB.label).toBe('Winner of Semi-final 2');
  });

  it('expands TBC markers without creating a dummy participant identity', () => {
    const projected = projectBracketMatch({
      id: 'semi-final-one',
      round: null,
      roundLabel: 'Semi-final 1',
      finalCode: null,
      scheduledAt: new Date('2026-08-01T08:00:00.000Z'),
      venue: 'The Hydro',
      status: 'SCHEDULED',
      scoreAvailable: false,
      homeScore: 0,
      awayScore: 0,
      homeTeam: null,
      awayTeam: null,
      slots: [
        { side: 'A', sourceLabel: 'Semi-finalist TBC', resolvedEntry: null },
        { side: 'B', sourceLabel: 'Semi-finalist TBC', resolvedEntry: null },
      ],
    }, 'Semi-finals');

    expect(projected.sideA.label).toBe('Semi-finalist to be confirmed');
    expect(projected.sideB.label).toBe('Semi-finalist to be confirmed');
    expect(JSON.stringify(projected)).not.toContain('TBC');
  });

  it('shows live bracket scores without exposing scheduled zero defaults', () => {
    const projected = projectBracketMatch({
      id: 'semi-final-live',
      round: null,
      roundLabel: 'Semi-final 1',
      finalCode: null,
      scheduledAt: new Date('2026-08-01T08:00:00.000Z'),
      venue: 'The Hydro',
      status: 'LIVE',
      scoreAvailable: true,
      homeScore: 31,
      awayScore: 29,
      homeTeam: { id: 'aus', name: 'Australia', abbreviation: 'AUS', logoUrl: null },
      awayTeam: { id: 'jam', name: 'Jamaica', abbreviation: 'JAM', logoUrl: null },
      slots: [],
    }, 'Semi-finals');

    expect(projected.sideA.score).toBe(31);
    expect(projected.sideB.score).toBe(29);
  });

  it('hides bracket scores when the shared public policy denies score access', async () => {
    mocks.canExposePublicMatchScore.mockReturnValue(false);
    mocks.findMany.mockResolvedValue([{
      id: 'semi-finals',
      slug: 'semi-finals',
      name: 'Semi-finals',
      type: 'SEMI_FINALS',
      sequence: 3,
      matches: [{
        id: 'semi-final-unverified',
        round: null,
        roundLabel: 'Semi-final 1',
        finalCode: null,
        scheduledAt: new Date('2026-08-01T08:00:00.000Z'),
        venue: 'The Hydro',
        status: 'COMPLETED',
        homeScore: 61,
        awayScore: 60,
        homeTeam: { id: 'aus', name: 'Australia', abbreviation: 'AUS', logoUrl: null },
        awayTeam: { id: 'jam', name: 'Jamaica', abbreviation: 'JAM', logoUrl: null },
        slots: [],
      }],
    }]);

    const edition = { id: 'glasgow-2026' } as never;
    const stages = await getTournamentBracket('glasgow-2026', edition);

    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledWith(
      ['semi-final-unverified'],
      [edition],
    );
    expect(stages[0].matches[0].sideA.score).toBeNull();
    expect(stages[0].matches[0].sideB.score).toBeNull();
  });

  it('omits bracket matches denied by the shared public policy', async () => {
    mocks.resolvePublicMatchAccessBatch.mockResolvedValue(new Map());
    mocks.findMany.mockResolvedValue([{
      id: 'medals',
      slug: 'medals',
      name: 'Medal Matches',
      type: 'MEDAL_MATCHES',
      sequence: 4,
      matches: [{
        id: 'unpublished-match',
        round: null,
        roundLabel: 'Gold medal match',
        finalCode: null,
        scheduledAt: new Date('2026-08-02T12:00:00.000Z'),
        venue: 'The Hydro',
        status: 'SCHEDULED',
        homeScore: 0,
        awayScore: 0,
        homeTeam: null,
        awayTeam: null,
        slots: [],
      }],
    }]);

    const stages = await getTournamentBracket('glasgow-2026');

    expect(stages[0].matches).toEqual([]);
  });

  it('batches a multi-stage bracket once while preserving per-match access filtering', async () => {
    const edition = { id: 'glasgow-2026' } as never;
    mocks.findMany.mockResolvedValue([
      {
        id: 'classification',
        slug: 'classification',
        name: 'Classification Matches',
        type: 'CLASSIFICATION',
        sequence: 2,
        matches: [bracketMatch('classification-allowed')],
      },
      {
        id: 'semi-finals',
        slug: 'semi-finals',
        name: 'Semi-finals',
        type: 'SEMI_FINALS',
        sequence: 3,
        matches: [bracketMatch('semi-final-denied')],
      },
      {
        id: 'medals',
        slug: 'medal-matches',
        name: 'Medal Matches',
        type: 'MEDAL_MATCHES',
        sequence: 4,
        matches: [bracketMatch('medal-score-blocked')],
      },
    ]);
    mocks.resolvePublicMatchAccessBatch.mockResolvedValue(new Map([
      ['classification-allowed', { scoreAvailable: true }],
      ['medal-score-blocked', { scoreAvailable: false }],
    ]));

    const stages = await getTournamentBracket('glasgow-2026', edition);

    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledOnce();
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledWith([
      'classification-allowed',
      'semi-final-denied',
      'medal-score-blocked',
    ], [edition]);
    expect(stages.map((stage) => stage.matches.map((match) => match.id))).toEqual([
      ['classification-allowed'],
      [],
      ['medal-score-blocked'],
    ]);
    expect(stages[0].matches[0].sideA.score).toBe(61);
    expect(stages[2].matches[0].sideA.score).toBeNull();
  });

  it('propagates bracket access infrastructure failures instead of returning empty stages', async () => {
    mocks.findMany.mockResolvedValue([{
      id: 'semi-finals',
      slug: 'semi-finals',
      name: 'Semi-finals',
      type: 'SEMI_FINALS',
      sequence: 3,
      matches: [bracketMatch('semi-final')],
    }]);
    mocks.resolvePublicMatchAccessBatch.mockRejectedValue(new Error('access database unavailable'));

    await expect(getTournamentBracket('glasgow-2026'))
      .rejects.toThrow('access database unavailable');
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledOnce();
  });

  it('loads only the published classification, semi-final and medal stages', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'classification',
        slug: 'classification',
        name: 'Classification Matches',
        type: 'CLASSIFICATION',
        sequence: 2,
        matches: [],
      },
      {
        id: 'semi-finals',
        slug: 'semi-finals',
        name: 'Semi-finals',
        type: 'SEMI_FINALS',
        sequence: 3,
        matches: [],
      },
      {
        id: 'medals',
        slug: 'medal-matches',
        name: 'Medal Matches',
        type: 'MEDAL_MATCHES',
        sequence: 4,
        matches: [],
      },
    ]);

    const stages = await getTournamentBracket('glasgow-2026');

    expect(stages.map((stage) => stage.type)).toEqual([
      'CLASSIFICATION',
      'SEMI_FINALS',
      'MEDAL_MATCHES',
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        competitionId: 'glasgow-2026',
        type: { in: ['CLASSIFICATION', 'SEMI_FINALS', 'MEDAL_MATCHES'] },
        isPublished: true,
      },
    }));
  });
});
