import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolvePublicMatchAccess: vi.fn(),
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
  resolvePublicMatchAccess: mocks.resolvePublicMatchAccess,
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

describe('public team match queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.resolvePublicMatchAccess.mockImplementation(async (id: string) => {
      if (id === 'match-blocked') return null;
      return { scoreAvailable: id === 'allowed' };
    });

    const results = await getRecentTeamMatches('edition', 'team-a');

    expect(results.map((result) => result.id)).toEqual(['allowed']);
    expect(mocks.resolvePublicMatchAccess).toHaveBeenCalledTimes(3);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15 }));
  });

  it('filters upcoming fixtures through the same public match resolver', async () => {
    mocks.findMany.mockResolvedValue([
      match('published', 'SCHEDULED'),
      match('unpublished-stage', 'SCHEDULED'),
    ]);
    mocks.resolvePublicMatchAccess.mockImplementation(async (id: string) => (
      id === 'published' ? { scoreAvailable: false } : null
    ));

    const results = await getUpcomingTeamMatches('edition', 'team-a');

    expect(results.map((result) => result.id)).toEqual(['published']);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });
});
