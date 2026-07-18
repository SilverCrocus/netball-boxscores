import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomepageMatch } from '@/lib/home-feed';

const { findMatchesMock, resolvePublicMatchMock, resolvePublicMatchBatchMock } = vi.hoisted(() => ({
  findMatchesMock: vi.fn(),
  resolvePublicMatchMock: vi.fn(),
  resolvePublicMatchBatchMock: vi.fn(),
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: resolvePublicMatchBatchMock,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: { isSimulation: false },
  prisma: { match: { findMany: findMatchesMock } },
}));

import {
  decodeCompletedCursor,
  deriveHomeHeader,
  encodeCompletedCursor,
  groupCompletedMatches,
  loadCompletedMatchesPage,
} from '@/lib/home-feed';

type HydratedTestMatch = HomepageMatch & { sourceUpdatedAt: Date | null };

function match(overrides: Partial<HydratedTestMatch> = {}): HydratedTestMatch {
  return {
    id: 'match-1',
    competitionId: 'competition-2026',
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    scheduledAt: new Date('2026-06-01T04:00:00Z'),
    homeScore: 62,
    awayScore: 58,
    sourceUpdatedAt: new Date('2026-07-25T09:00:01.000Z'),
    venue: 'Arena',
    round: 10,
    roundLabel: null,
    finalCode: null,
    stage: null,
    currentQuarter: null,
    currentTime: null,
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeTeam: { name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
    awayTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
    competition: {
      dataCoverage: [
        { capability: 'FINAL_SCORE', state: 'AVAILABLE' },
        { capability: 'SUPER_SHOTS', state: 'AVAILABLE' },
      ],
    },
    dataCoverage: [],
    teamStats: [],
    ...overrides,
  };
}

function publicAccess(overrides: Record<string, unknown> = {}) {
  return {
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    sourceUpdatedAt: new Date('2026-07-25T09:00:01.000Z'),
    scoreAvailable: true,
    features: { superShots: { available: true } },
    ...overrides,
  };
}

describe('home results feed', () => {
  beforeEach(() => {
    findMatchesMock.mockReset();
    resolvePublicMatchMock.mockReset().mockResolvedValue(publicAccess());
    resolvePublicMatchBatchMock.mockReset().mockImplementation(async (ids: string[]) => {
      const entries = await Promise.all(ids.map(async (id) => (
        [id, await resolvePublicMatchMock(id)] as const
      )));
      return new Map(entries.filter((entry): entry is readonly [string, ReturnType<typeof publicAccess>] => (
        entry[1] !== null
      )));
    });
  });

  it('round-trips a stable completed-match cursor', () => {
    const source = match();
    expect(decodeCompletedCursor(encodeCompletedCursor(source))).toEqual({
      id: source.id,
      scheduledAt: source.scheduledAt.toISOString(),
    });
    expect(decodeCompletedCursor('not-a-cursor')).toBeNull();
  });

  it('loads only one bounded page and returns a next cursor', async () => {
    const matches = Array.from({ length: 9 }, (_, index) => match({
      id: `match-${9 - index}`,
      scheduledAt: new Date(Date.UTC(2026, 5, 9 - index)),
    }));
    findMatchesMock.mockResolvedValue(matches);

    const page = await loadCompletedMatchesPage('competition-2026');

    expect(page.groups.flatMap((group) => group.matches)).toHaveLength(8);
    expect(page.nextCursor).not.toBeNull();
    expect(findMatchesMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        competitionId: 'competition-2026',
        isSimulation: false,
        status: 'COMPLETED',
        AND: expect.arrayContaining([{
          OR: [
            { stageId: null },
            { stage: { is: { isPublished: true } } },
          ],
        }]),
      }),
      take: 73,
    }));
  });

  it('revalidates cached candidates before every result response', async () => {
    findMatchesMock.mockResolvedValue([match()]);
    resolvePublicMatchMock
      .mockResolvedValueOnce(publicAccess())
      .mockResolvedValueOnce(null);

    const first = await loadCompletedMatchesPage('competition-2026');
    const second = await loadCompletedMatchesPage('competition-2026');

    expect(first.groups.flatMap((group) => group.matches)).toHaveLength(1);
    expect(second.groups).toEqual([]);
    expect(resolvePublicMatchMock).toHaveBeenCalledTimes(2);
  });

  it('removes cached super-shot detail after capability revocation', async () => {
    findMatchesMock.mockResolvedValue([match({
      teamStats: [
        { teamId: 'home', goals: 62, goal2: 2 },
        { teamId: 'away', goals: 58, goal2: 0 },
      ],
    })]);
    resolvePublicMatchMock.mockResolvedValue(publicAccess({
      features: { superShots: { available: false } },
    }));

    const page = await loadCompletedMatchesPage('competition-2026');
    const result = page.groups[0].matches[0];

    expect(result.homeBreakdown).toBeNull();
    expect(result.awayBreakdown).toBeNull();
  });

  it('excludes a score-capable cached candidate when fresh access says it is live', async () => {
    findMatchesMock.mockResolvedValue([match({ id: 'stale-live-candidate' })]);
    resolvePublicMatchMock.mockResolvedValue(publicAccess({
      status: 'LIVE',
      resultQuality: 'UNKNOWN',
    }));

    const page = await loadCompletedMatchesPage('competition-2026');

    expect(page.groups).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('scans past a denied candidate batch to return older public results', async () => {
    const denied = Array.from({ length: 9 }, (_, index) => match({
      id: `denied-${index}`,
      scheduledAt: new Date(Date.UTC(2026, 5, 20 - index)),
    }));
    const older = [
      match({ id: 'older-2', scheduledAt: new Date('2026-06-10T04:00:00Z') }),
      match({ id: 'older-1', scheduledAt: new Date('2026-06-09T04:00:00Z') }),
    ];
    findMatchesMock.mockResolvedValue([...denied, ...older]);
    resolvePublicMatchMock.mockImplementation(async (id: string) => (
      id.startsWith('denied-') ? null : publicAccess()
    ));

    const page = await loadCompletedMatchesPage('competition-2026');

    expect(page.groups.flatMap((group) => group.matches).map((result) => result.id))
      .toEqual(['older-1', 'older-2']);
    expect(page.nextCursor).toBeNull();
    expect(findMatchesMock).toHaveBeenCalledTimes(2);
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledOnce();
  });

  it('returns a continuation cursor when the bounded denied-row scan is exhausted', async () => {
    const denied = Array.from({ length: 73 }, (_, index) => match({
      id: `denied-${index}`,
      scheduledAt: new Date(Date.UTC(2026, 5, 30 - index)),
    }));
    findMatchesMock.mockResolvedValue(denied);
    resolvePublicMatchMock.mockResolvedValue(null);

    const page = await loadCompletedMatchesPage('competition-2026');
    const lastScanned = denied[71];

    expect(page.groups).toEqual([]);
    expect(decodeCompletedCursor(page.nextCursor!)).toEqual({
      id: lastScanned.id,
      scheduledAt: lastScanned.scheduledAt.toISOString(),
    });
    expect(findMatchesMock).toHaveBeenCalledTimes(2);
    expect(resolvePublicMatchBatchMock).toHaveBeenCalledOnce();
  });

  it('groups finals before older regular rounds in query order', () => {
    const groups = groupCompletedMatches([
      match({ id: 'gf', finalCode: 'GRAND', round: 3 }),
      match({ id: 'r14', finalCode: null, round: 14 }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['Grand Final', 'Round 14']);
  });

  it('groups tournament matches by their explicit published label without a numerical round', () => {
    const groups = groupCompletedMatches([
      match({
        id: 'pool-a-day-one',
        round: null,
        roundLabel: 'Pool A — 25 July',
        stage: { name: 'Pool Stage' },
      }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['Pool A — 25 July']);
  });

  it('excludes completed rows until result quality and final-score coverage are valid', () => {
    expect(groupCompletedMatches([
      match({ id: 'unknown', resultQuality: 'UNKNOWN', homeScore: 0, awayScore: 0 }),
      match({
        id: 'uncovered',
        competition: { dataCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE' }] },
      }),
    ])).toEqual([]);
  });

  it('derives useful headings from the current season state', () => {
    expect(deriveHomeHeader(2026, [match({ status: 'LIVE' })], [], []).heading).toBe('LIVE NOW');
    expect(deriveHomeHeader(2026, [], [match({ status: 'SCHEDULED' })], []).heading).toBe('UPCOMING');
    expect(deriveHomeHeader(2026, [], [], groupCompletedMatches([
      match({ finalCode: 'GRAND', homeScore: 70, awayScore: 64 }),
    ]))).toMatchObject({
      heading: 'CHAMPIONS CROWNED',
      description: 'Vipers won the Grand Final 70-64.',
    });
  });
});
