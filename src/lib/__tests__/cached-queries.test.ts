import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolvePublicMatchAccessBatch: vi.fn(),
  canExposePublicMatchScore: vi.fn(),
}));

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findMany: mocks.findMany },
  },
  excludeSimData: { isSimulation: false },
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccessBatch: mocks.resolvePublicMatchAccessBatch,
  canExposePublicMatchScore: mocks.canExposePublicMatchScore,
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn().mockResolvedValue([]),
}));

import {
  getRecentTeamMatches,
  getUpcomingTeamMatches,
} from '@/lib/cached-queries';

function match(id: string, status: 'COMPLETED' | 'SCHEDULED') {
  return {
    id,
    status,
    homeTeamId: 'team-a',
    awayTeamId: 'team-b',
    homeScore: status === 'COMPLETED' ? 60 : 0,
    awayScore: status === 'COMPLETED' ? 55 : 0,
    scheduledAt: new Date('2026-07-25T09:00:00.000Z'),
    homeTeam: { name: 'Team A', abbreviation: 'A', logoUrl: null },
    awayTeam: { name: 'Team B', abbreviation: 'B', logoUrl: null },
  };
}

const edition = { id: 'edition' } as never;

describe('public team match queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePublicMatchAccessBatch.mockResolvedValue(new Map());
    mocks.canExposePublicMatchScore.mockImplementation(
      (access: { scoreAvailable: boolean }) => access.scoreAvailable,
    );
  });

  it('returns recent results only when full public access and score policy allow them', async () => {
    mocks.findMany.mockResolvedValue([
      match('allowed', 'COMPLETED'),
      match('score-blocked', 'COMPLETED'),
      match('match-blocked', 'COMPLETED'),
    ]);
    mocks.resolvePublicMatchAccessBatch.mockResolvedValue(new Map([
      ['allowed', { scoreAvailable: true }],
      ['score-blocked', { scoreAvailable: false }],
    ]));

    const results = await getRecentTeamMatches('edition', 'team-a', edition);

    expect(results.map((result) => result.id)).toEqual(['allowed']);
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledOnce();
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledWith(
      ['allowed', 'score-blocked', 'match-blocked'],
      [edition],
    );
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15 }));
  });

  it('filters upcoming fixtures through the same public match resolver', async () => {
    mocks.findMany.mockResolvedValue([
      match('published', 'SCHEDULED'),
      match('unpublished-stage', 'SCHEDULED'),
    ]);
    mocks.resolvePublicMatchAccessBatch.mockResolvedValue(new Map([
      ['published', { scoreAvailable: false }],
    ]));

    const results = await getUpcomingTeamMatches('edition', 'team-a', edition);

    expect(results.map((result) => result.id)).toEqual(['published']);
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledOnce();
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledWith(
      ['published', 'unpublished-stage'],
      [edition],
    );
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('rechecks current score access on every recent-results request', async () => {
    mocks.findMany.mockResolvedValue([match('candidate', 'COMPLETED')]);
    mocks.resolvePublicMatchAccessBatch
      .mockResolvedValueOnce(new Map([['candidate', { scoreAvailable: true }]]))
      .mockResolvedValueOnce(new Map([['candidate', { scoreAvailable: false }]]));

    const first = await getRecentTeamMatches('edition', 'team-a');
    const second = await getRecentTeamMatches('edition', 'team-a');

    expect(first.map((result) => result.id)).toEqual(['candidate']);
    expect(second).toEqual([]);
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledTimes(2);
  });

  it('preserves candidate order while applying access, team-resolution, and display limits', async () => {
    const recentCandidates = Array.from({ length: 8 }, (_, index) => (
      match(`recent-${index + 1}`, 'COMPLETED')
    ));
    const upcomingCandidates = Array.from({ length: 6 }, (_, index) => (
      match(`upcoming-${index + 1}`, 'SCHEDULED')
    ));
    recentCandidates[2] = { ...recentCandidates[2], awayTeamId: null } as never;
    upcomingCandidates[1] = { ...upcomingCandidates[1], homeTeam: null } as never;
    mocks.findMany
      .mockResolvedValueOnce(recentCandidates)
      .mockResolvedValueOnce(upcomingCandidates);
    mocks.resolvePublicMatchAccessBatch
      .mockResolvedValueOnce(new Map(
        recentCandidates
          .filter((candidate) => candidate.id !== 'recent-4')
          .map((candidate) => [candidate.id, { scoreAvailable: true }]),
      ))
      .mockResolvedValueOnce(new Map(
        upcomingCandidates
          .filter((candidate) => candidate.id !== 'upcoming-3')
          .map((candidate) => [candidate.id, { scoreAvailable: false }]),
      ));

    const recent = await getRecentTeamMatches('edition', 'team-a');
    const upcoming = await getUpcomingTeamMatches('edition', 'team-a');

    expect(recent.map((candidate) => candidate.id)).toEqual([
      'recent-1',
      'recent-2',
      'recent-5',
      'recent-6',
      'recent-7',
    ]);
    expect(upcoming.map((candidate) => candidate.id)).toEqual([
      'upcoming-1',
      'upcoming-4',
      'upcoming-5',
    ]);
    expect(mocks.resolvePublicMatchAccessBatch).toHaveBeenCalledTimes(2);
  });

  it('propagates access resolver failures instead of returning false-empty team results', async () => {
    mocks.findMany.mockResolvedValue([match('candidate', 'COMPLETED')]);
    mocks.resolvePublicMatchAccessBatch.mockRejectedValue(new Error('access database unavailable'));

    await expect(getRecentTeamMatches('edition', 'team-a'))
      .rejects.toThrow('access database unavailable');
  });

  it('propagates candidate query failures before attempting access resolution', async () => {
    mocks.findMany.mockRejectedValue(new Error('match database unavailable'));

    await expect(getUpcomingTeamMatches('edition', 'team-a'))
      .rejects.toThrow('match database unavailable');
    expect(mocks.resolvePublicMatchAccessBatch).not.toHaveBeenCalled();
  });
});
