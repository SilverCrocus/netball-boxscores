import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueMock, resolvePublicMatchMock, notFoundMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
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

const availableFeature = (capability: string) => ({
  capability,
  state: 'AVAILABLE',
  scope: 'edition',
  available: true,
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

function seededMatch(overrides: Record<string, unknown> = {}) {
  return {
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
    dataCoverage: [],
    quarters: [],
    playerStats: [],
    scoreFlow: [],
    _count: { matchEvents: 0 },
    ...overrides,
  };
}

function allCapabilitiesAccess(
  status: 'SCHEDULED' | 'COMPLETED',
  resultQuality: 'UNKNOWN' | 'OFFICIAL_FINAL' = 'UNKNOWN',
) {
  return {
    ...scheduledPublicAccess,
    status,
    resultQuality,
    features: Object.fromEntries(Object.entries(scheduledPublicAccess.features).map(
      ([key, feature]) => [key, availableFeature(feature.capability)],
    )),
  };
}

vi.mock('@/components/match/MatchActions', () => ({ MatchActions: () => null }));
vi.mock('@/lib/public-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/public-match')>();
  return { ...actual, resolvePublicMatchForRequest: resolvePublicMatchMock };
});
vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));
vi.mock('@/lib/db', () => ({
  prisma: { match: { findUnique: findUniqueMock } },
}));

import MatchPage from '../page';

describe('scheduled match page', () => {
  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(seededMatch());
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

  it.each([
    ['scheduled', 'SCHEDULED', 'UNKNOWN'],
    ['unverified completed', 'COMPLETED', 'UNKNOWN'],
  ] as const)('hides seeded result modules for a %s match', async (_label, status, resultQuality) => {
    findUniqueMock.mockResolvedValue(seededMatch({
      status,
      resultQuality,
      homeScore: 72,
      awayScore: 70,
      quarters: [{ quarter: 1, homeScore: 18, awayScore: 17 }],
      scoreFlow: [{
        id: 'score-1', period: 1, periodSeconds: 100, scoringTeamId: 'australia',
        homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayerId: 'player-1',
      }],
      playerStats: [{
        id: 'stats-1', goals: 20, attempts: 21, goalAssists: 2, intercepts: 1,
        deflections: 2, rebounds: 1, penalties: 3, feeds: 5, centrePassReceives: 4,
        turnovers: 1, minutesPlayed: 60, netPoints: 90, gain: 2,
        player: {
          id: 'player-1', name: 'Seeded Player', position: 'GA', teamId: 'australia',
          photoUrl: null, photoSourceUrl: null, photoCredit: null, photoLicense: null,
          rosterMemberships: [],
        },
      }],
      _count: { matchEvents: 1 },
    }));
    resolvePublicMatchMock.mockResolvedValue(allCapabilitiesAccess(status, resultQuality));

    render(await MatchPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(screen.queryByText('Box Score')).not.toBeInTheDocument();
    expect(screen.queryByText('Match Momentum')).not.toBeInTheDocument();
    expect(screen.queryByText('Quarter Breakdown')).not.toBeInTheDocument();
    expect(screen.queryByText('Top NetPoints')).not.toBeInTheDocument();
    expect(screen.queryByText('Seeded Player')).not.toBeInTheDocument();
    expect(screen.queryByText('72')).not.toBeInTheDocument();
  });
});
