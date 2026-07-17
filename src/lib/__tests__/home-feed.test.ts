import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomepageMatch } from '@/lib/home-feed';

const { findMatchesMock } = vi.hoisted(() => ({
  findMatchesMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  excludeSimData: { isSimulated: false },
  prisma: { match: { findMany: findMatchesMock } },
}));

import {
  decodeCompletedCursor,
  deriveHomeHeader,
  encodeCompletedCursor,
  groupCompletedMatches,
  loadCompletedMatchesPage,
} from '@/lib/home-feed';

function match(overrides: Partial<HomepageMatch> = {}): HomepageMatch {
  return {
    id: 'match-1',
    competitionId: 'competition-2026',
    status: 'COMPLETED',
    scheduledAt: new Date('2026-06-01T04:00:00Z'),
    homeScore: 62,
    awayScore: 58,
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
    teamStats: [],
    ...overrides,
  };
}

describe('home results feed', () => {
  beforeEach(() => findMatchesMock.mockReset());

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
        isSimulated: false,
        status: 'COMPLETED',
      }),
      take: 9,
    }));
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
