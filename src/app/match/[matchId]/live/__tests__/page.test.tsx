import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findUniqueMock,
  liveClientPropsMock,
  notFoundMock,
  redirectMock,
  resolvePublicMatchMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  liveClientPropsMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirectMock: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
  resolvePublicMatchMock: vi.fn(),
}));

const capability = (name: string, available: boolean) => ({
  capability: name,
  state: available ? 'AVAILABLE' : 'UNAVAILABLE',
  scope: 'edition',
  available,
});

function publicAccess(status: 'SCHEDULED' | 'LIVE' | 'COMPLETED', available: string[] = []) {
  return {
    id: 'glasgow-match-1',
    competitionId: 'glasgow-2026',
    status,
    resultQuality: status === 'COMPLETED' ? 'OFFICIAL_FINAL' : 'UNKNOWN',
    scheduledAt: new Date('2026-07-25T08:00:00Z'),
    homeTeamId: 'australia',
    awayTeamId: 'england',
    features: {
      finalScore: capability('FINAL_SCORE', available.includes('FINAL_SCORE')),
      periodScores: capability('PERIOD_SCORES', available.includes('PERIOD_SCORES')),
      teamBoxScore: capability('TEAM_BOX_SCORE', available.includes('TEAM_BOX_SCORE')),
      playerBoxScore: capability('PLAYER_BOX_SCORE', available.includes('PLAYER_BOX_SCORE')),
      netPoints: capability('NET_POINTS', available.includes('NET_POINTS')),
      matchEvents: capability('MATCH_EVENTS', available.includes('MATCH_EVENTS')),
      scoreFlow: capability('SCORE_FLOW', available.includes('SCORE_FLOW')),
      superShots: capability('SUPER_SHOTS', available.includes('SUPER_SHOTS')),
      lineups: capability('LINEUPS', available.includes('LINEUPS')),
    },
  };
}

const scheduledMatch = {
  id: 'glasgow-match-1',
  competitionId: 'glasgow-2026',
  status: 'SCHEDULED',
  resultQuality: 'UNKNOWN',
  scheduledAt: new Date('2026-07-25T08:00:00Z'),
  homeTeamId: 'australia',
  awayTeamId: 'england',
  homeTeam: { id: 'australia' },
  awayTeam: { id: 'england' },
};

function detailedMatch(status: 'LIVE' | 'COMPLETED') {
  return {
    ...scheduledMatch,
    status,
    resultQuality: status === 'COMPLETED' ? 'OFFICIAL_FINAL' : 'UNKNOWN',
    round: null,
    roundLabel: 'Pool A · Day 1',
    finalCode: null,
    venue: 'SEC Centre',
    homeScore: 10,
    awayScore: 8,
    currentQuarter: status === 'LIVE' ? 1 : null,
    currentTime: status === 'LIVE' ? '05:00' : null,
    stage: { name: 'Pool Stage' },
    homeTeam: {
      id: 'australia', name: 'Australia', abbreviation: 'AUS', logoUrl: null, primaryColor: null,
      editionEntries: [{
        competitionId: 'glasgow-2026',
        roster: [{
          status: status === 'LIVE' ? 'ACTIVE' : 'REPLACED',
          validFrom: new Date('2026-07-01T00:00:00Z'),
          validTo: status === 'LIVE' ? null : new Date('2026-07-26T00:00:00Z'),
          designatedPosition: 'GA',
          player: {
            id: 'player-1', name: 'Shared Player', position: 'C', teamId: 'nsw-swifts',
            matchStats: [{ goals: 4 }],
          },
        }],
      }],
    },
    awayTeam: {
      id: 'england', name: 'England', abbreviation: 'ENG', logoUrl: null, primaryColor: null,
      editionEntries: [{ competitionId: 'glasgow-2026', roster: [] }],
    },
    quarters: [],
    scoreFlow: [],
    matchEvents: [],
  };
}

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}));
vi.mock('@/lib/db', () => ({
  prisma: { match: { findUnique: findUniqueMock } },
}));
vi.mock('@/lib/public-match', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/public-match')>(),
  resolvePublicMatchForRequest: resolvePublicMatchMock,
}));
vi.mock('@/lib/win-probability', () => ({
  computeTeamStrengthPrior: vi.fn().mockResolvedValue(null),
}));
vi.mock('../LiveGameClient', () => ({
  LiveGameClient: (props: {
    match: {
      homeTeam: { players: Array<{ name: string }> };
      awayTeam: { players: Array<{ name: string }> };
      quarters: unknown[];
      initialScoreFlow: unknown[];
      initialMatchEvents: Array<{ eventId: string }>;
    };
    realtimeEnabled: boolean;
  }) => {
    liveClientPropsMock(props);
    return (
      <div>
        {[...props.match.homeTeam.players, ...props.match.awayTeam.players]
          .map((player) => player.name)
          .join(', ')}
      </div>
    );
  },
}));

import LiveGamePage from '../page';

const liveCapabilities = ['FINAL_SCORE', 'PLAYER_BOX_SCORE', 'LINEUPS'];

describe('live match route safety', () => {
  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(scheduledMatch);
    resolvePublicMatchMock.mockReset().mockResolvedValue(publicAccess('SCHEDULED'));
    liveClientPropsMock.mockClear();
    notFoundMock.mockClear();
    redirectMock.mockClear();
  });

  it('returns an unsupported scheduled fixture to its canonical match page', async () => {
    await expect(LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('REDIRECT:/match/glasgow-match-1?edition=glasgow-2026');
  });

  it('returns not found when the shared public gate denies the match', async () => {
    resolvePublicMatchMock.mockResolvedValueOnce(null);

    await expect(LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledOnce();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('builds national-team lineups from the edition roster, not the player club team', async () => {
    findUniqueMock.mockResolvedValue(detailedMatch('LIVE'));
    resolvePublicMatchMock.mockResolvedValue(publicAccess('LIVE', liveCapabilities));

    render(await LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(screen.getByText('Shared Player')).toBeInTheDocument();
    expect(liveClientPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      realtimeEnabled: true,
    }));
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('keeps a verified completed fixture subscribed for correction and reopen replay', async () => {
    findUniqueMock.mockResolvedValue(detailedMatch('COMPLETED'));
    resolvePublicMatchMock.mockResolvedValue(publicAccess('COMPLETED', liveCapabilities));

    render(await LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(screen.getByText('Shared Player')).toBeInTheDocument();
    expect(liveClientPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      match: expect.objectContaining({ status: 'COMPLETED' }),
      realtimeEnabled: true,
    }));
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each(['PLAYER_BOX_SCORE', 'SCORE_FLOW', 'MATCH_EVENTS'])(
    'enables completed-page canonical replay when %s is the public realtime detail',
    async (detailCapability) => {
      findUniqueMock.mockResolvedValue(detailedMatch('COMPLETED'));
      resolvePublicMatchMock.mockResolvedValue(publicAccess('COMPLETED', [
        'FINAL_SCORE',
        detailCapability,
      ]));

      render(await LiveGamePage({
        params: Promise.resolve({ matchId: 'glasgow-match-1' }),
        searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
      }));

      expect(liveClientPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({
        match: expect.objectContaining({ status: 'COMPLETED' }),
        realtimeEnabled: true,
      }));
      expect(redirectMock).not.toHaveBeenCalled();
    },
  );

  it('renders completed score-only coverage and keeps correction replay enabled', async () => {
    findUniqueMock.mockResolvedValue(detailedMatch('COMPLETED'));
    resolvePublicMatchMock.mockResolvedValue(publicAccess('COMPLETED', ['FINAL_SCORE']));

    render(await LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(liveClientPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      match: expect.objectContaining({ status: 'COMPLETED' }),
      realtimeEnabled: true,
      capabilities: expect.objectContaining({
        playerBoxScore: false,
        scoreFlow: false,
        matchEvents: false,
      }),
    }));
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('does not serialize roster stats, periods, or events without their capabilities', async () => {
    const match = detailedMatch('LIVE');
    match.quarters = [{ quarter: 1, homeScore: 10, awayScore: 8 }] as never;
    match.scoreFlow = [{
      period: 1, periodSeconds: 300, scoringTeamId: 'australia',
      homeScore: 10, awayScore: 8, scorePoints: 1, scorerPlayer: null,
    }] as never;
    match.matchEvents = [{
      id: 'private-event', type: 'intercept', period: 1, periodSeconds: 300,
      playerId: 'player-1', player: { name: 'Shared Player' }, teamId: 'australia',
      team: { name: 'Australia', abbreviation: 'AUS', logoUrl: null },
    }] as never;
    findUniqueMock.mockResolvedValue(match);
    resolvePublicMatchMock.mockResolvedValue(publicAccess('LIVE', [
      'FINAL_SCORE',
      'SCORE_FLOW',
    ]));

    render(await LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(liveClientPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      match: expect.objectContaining({
        homeTeam: expect.objectContaining({ players: [] }),
        awayTeam: expect.objectContaining({ players: [] }),
        quarters: [],
        initialScoreFlow: [expect.objectContaining({ matchId: 'glasgow-match-1' })],
        initialMatchEvents: [],
      }),
      capabilities: expect.objectContaining({
        lineups: false,
        playerBoxScore: false,
        periodScores: false,
        matchEvents: false,
        scoreFlow: true,
      }),
    }));
  });

  it('includes canonical event ids only when MATCH_EVENTS coverage is public', async () => {
    const match = detailedMatch('LIVE');
    match.matchEvents = [{
      id: 'event-1', type: 'intercept', period: 1, periodSeconds: 300,
      playerId: 'player-1', player: { name: 'Shared Player' }, teamId: 'australia',
      team: { name: 'Australia', abbreviation: 'AUS', logoUrl: null },
    }] as never;
    findUniqueMock.mockResolvedValue(match);
    resolvePublicMatchMock.mockResolvedValue(publicAccess('LIVE', [
      'FINAL_SCORE',
      'MATCH_EVENTS',
    ]));

    render(await LiveGamePage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(liveClientPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      match: expect.objectContaining({
        initialMatchEvents: [expect.objectContaining({ eventId: 'event-1' })],
      }),
    }));
  });
});
