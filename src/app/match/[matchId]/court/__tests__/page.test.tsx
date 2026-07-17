import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  courtClientPropsMock,
  findUniqueMock,
  notFoundMock,
  redirectMock,
  resolvePublicMatchMock,
} = vi.hoisted(() => ({
  courtClientPropsMock: vi.fn(),
  findUniqueMock: vi.fn(),
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

function publicAccess(status: 'SCHEDULED' | 'COMPLETED', available: string[] = []) {
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

const completedMatch = {
  ...scheduledMatch,
  status: 'COMPLETED',
  resultQuality: 'OFFICIAL_FINAL',
  homeScore: 60,
  awayScore: 55,
  homeTeam: {
    id: 'australia',
    name: 'Australia',
    abbreviation: 'AUS',
    logoUrl: null,
    editionEntries: [{
      competitionId: 'glasgow-2026',
      roster: [{
        status: 'REPLACED',
        validFrom: new Date('2026-07-01T00:00:00Z'),
        validTo: new Date('2026-07-26T00:00:00Z'),
        designatedPosition: 'GD',
        player: {
          id: 'player-1',
          name: 'Historical Defender',
          position: 'GK',
          teamId: 'australia',
          matchStats: [{ turnovers: 2 }],
        },
      }, {
        status: 'ACTIVE',
        validFrom: new Date('2026-07-26T00:00:00Z'),
        validTo: null,
        designatedPosition: 'C',
        player: {
          id: 'player-future',
          name: 'Future Reserve',
          position: 'C',
          teamId: 'australia',
          matchStats: [],
        },
      }],
    }],
  },
  awayTeam: {
    id: 'england',
    name: 'England',
    abbreviation: 'ENG',
    logoUrl: null,
    editionEntries: [{ competitionId: 'glasgow-2026', roster: [] }],
  },
};

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}));
vi.mock('@/lib/db', () => ({
  prisma: { match: { findUnique: findUniqueMock } },
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchForRequest: resolvePublicMatchMock,
  canExposePublicMatchScore: (access: ReturnType<typeof publicAccess>) => (
    access.features.finalScore.available
    && access.status === 'COMPLETED'
  ),
}));
vi.mock('../CourtClient', () => ({
  CourtClient: (props: {
    match: {
      homeTeam: { players: Array<{ name: string }> };
      awayTeam: { players: Array<{ name: string }> };
    };
    realtimeEnabled: boolean;
  }) => {
    courtClientPropsMock(props);
    return (
      <div>
        {[...props.match.homeTeam.players, ...props.match.awayTeam.players]
          .map((player) => player.name)
          .join(', ')}
      </div>
    );
  },
}));

import CourtPage from '../page';

describe('court route safety', () => {
  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(scheduledMatch);
    resolvePublicMatchMock.mockReset().mockResolvedValue(publicAccess('SCHEDULED'));
    courtClientPropsMock.mockClear();
    notFoundMock.mockClear();
    redirectMock.mockClear();
  });

  it('returns an unsupported scheduled fixture to its canonical match page', async () => {
    await expect(CourtPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('REDIRECT:/match/glasgow-match-1?edition=glasgow-2026');
  });

  it('returns not found when the shared public gate denies the match', async () => {
    resolvePublicMatchMock.mockResolvedValueOnce(null);

    await expect(CourtPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('NOT_FOUND');

    expect(notFoundMock).toHaveBeenCalledOnce();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('renders a verified completed fixture with its historical roster and realtime disabled', async () => {
    findUniqueMock.mockResolvedValue(completedMatch);
    resolvePublicMatchMock.mockResolvedValue(publicAccess('COMPLETED', [
      'PLAYER_BOX_SCORE',
      'LINEUPS',
      'FINAL_SCORE',
    ]));

    render(await CourtPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    }));

    expect(screen.getByText('Historical Defender')).toBeInTheDocument();
    expect(screen.queryByText('Future Reserve')).not.toBeInTheDocument();
    expect(courtClientPropsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      realtimeEnabled: false,
    }));
    const props = courtClientPropsMock.mock.lastCall?.[0];
    expect(JSON.stringify(props)).not.toContain('editionEntries');
    expect(JSON.stringify(props)).not.toContain('Future Reserve');
    expect(Object.keys(props.match).sort()).toEqual([
      'awayScore',
      'awayTeam',
      'currentQuarter',
      'currentTime',
      'homeScore',
      'homeTeam',
      'id',
      'status',
    ]);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects when lineups exist but the public final score is unavailable', async () => {
    findUniqueMock.mockResolvedValue(completedMatch);
    resolvePublicMatchMock.mockResolvedValue(publicAccess('COMPLETED', [
      'PLAYER_BOX_SCORE',
      'LINEUPS',
    ]));

    await expect(CourtPage({
      params: Promise.resolve({ matchId: 'glasgow-match-1' }),
      searchParams: Promise.resolve({ edition: 'glasgow-2026' }),
    })).rejects.toThrow('REDIRECT:/match/glasgow-match-1?edition=glasgow-2026');

    expect(courtClientPropsMock).not.toHaveBeenCalled();
  });
});
