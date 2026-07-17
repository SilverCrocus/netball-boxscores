import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolvePublicMatchMock, notFoundMock } = vi.hoisted(() => ({
  resolvePublicMatchMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const unavailableFeature = (capability: string) => ({
  capability,
  state: 'UNAVAILABLE',
  scope: 'edition',
  available: false,
});

const scheduledPublicAccess = {
  id: 'glasgow-match-1',
  competitionId: 'glasgow-2026',
  status: 'SCHEDULED',
  resultQuality: 'UNKNOWN',
  scheduledAt: new Date('2026-07-25T08:00:00Z'),
  homeTeamId: 'australia',
  awayTeamId: 'england',
  features: {
    finalScore: unavailableFeature('FINAL_SCORE'),
    periodScores: unavailableFeature('PERIOD_SCORES'),
    teamBoxScore: unavailableFeature('TEAM_BOX_SCORE'),
    playerBoxScore: unavailableFeature('PLAYER_BOX_SCORE'),
    netPoints: unavailableFeature('NET_POINTS'),
    matchEvents: unavailableFeature('MATCH_EVENTS'),
    scoreFlow: unavailableFeature('SCORE_FLOW'),
    superShots: unavailableFeature('SUPER_SHOTS'),
    lineups: unavailableFeature('LINEUPS'),
  },
};

vi.mock('@/components/match/MatchActions', () => ({ MatchActions: () => null }));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchForRequest: resolvePublicMatchMock,
}));
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'glasgow-match-1',
        competitionId: 'glasgow-2026',
        status: 'SCHEDULED',
        resultQuality: 'UNKNOWN',
        homeScore: 0,
        awayScore: 0,
        currentQuarter: null,
        currentTime: null,
        round: null,
        roundLabel: 'Pool A · Day 1',
        finalCode: null,
        stage: { name: 'Pool Stage' },
        venue: 'SEC Centre',
        scheduledAt: new Date('2026-07-25T08:00:00Z'),
        homeTeamId: 'australia',
        awayTeamId: 'england',
        homeTeam: { name: 'Australia', abbreviation: 'AUS', logoUrl: null, slug: 'australia' },
        awayTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null, slug: 'england' },
        competition: {
          dataCoverage: [
            { capability: 'FINAL_SCORE', state: 'UNAVAILABLE' },
            { capability: 'PERIOD_SCORES', state: 'UNAVAILABLE' },
            { capability: 'PLAYER_BOX_SCORE', state: 'UNAVAILABLE' },
            { capability: 'SCORE_FLOW', state: 'UNAVAILABLE' },
            { capability: 'MATCH_EVENTS', state: 'UNAVAILABLE' },
            { capability: 'NET_POINTS', state: 'UNAVAILABLE' },
            { capability: 'SUPER_SHOTS', state: 'UNAVAILABLE' },
            { capability: 'LINEUPS', state: 'UNAVAILABLE' },
          ],
        },
        dataCoverage: [],
        quarters: [],
        playerStats: [],
        scoreFlow: [],
        _count: { matchEvents: 0 },
      }),
    },
  },
}));

import MatchPage from '../page';

describe('scheduled match page', () => {
  beforeEach(() => {
    resolvePublicMatchMock.mockReset().mockResolvedValue(scheduledPublicAccess);
    notFoundMock.mockClear();
  });

  it('shows honest fixture coverage instead of a false final 0-0 or empty stats', async () => {
    render(await MatchPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(screen.getByRole('heading', { name: 'Scheduled fixture' })).toBeInTheDocument();
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.queryByText('Final')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Box Score')).not.toBeInTheDocument();
    expect(screen.queryByText('Match Momentum')).not.toBeInTheDocument();
  });

  it('returns not found when the edition is not public-ready', async () => {
    resolvePublicMatchMock.mockResolvedValueOnce(null);

    await expect(MatchPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
