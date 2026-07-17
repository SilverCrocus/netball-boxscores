import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useMatchSocketMock } = vi.hoisted(() => ({
  useMatchSocketMock: vi.fn(),
}));

vi.mock('@/hooks/useMatchSocket', () => ({ useMatchSocket: useMatchSocketMock }));
vi.mock('@/components/match/NetballCourt', () => ({
  NetballCourt: ({ homePlayers, awayPlayers }: {
    homePlayers: Array<{ name: string; position: string }>;
    awayPlayers: Array<{ name: string; position: string }>;
  }) => (
    <div data-testid="court-players">
      {[...homePlayers, ...awayPlayers]
        .map((player) => `${player.name}:${player.position}`)
        .join('|')}
    </div>
  ),
}));

import { CourtClient } from '@/app/match/[matchId]/court/CourtClient';

function player(id: string, name: string, position: string, turnovers: number) {
  return {
    id,
    name,
    position,
    matchStats: [{ turnovers }],
  };
}

const match = {
  id: 'match-1',
  status: 'LIVE',
  homeScore: 1,
  awayScore: 2,
  currentQuarter: 1,
  currentTime: '600',
  homeTeam: {
    name: 'Country A',
    players: [player('home-player', 'Home Player', 'GS', 1)],
  },
  awayTeam: {
    name: 'Country B',
    players: [player('away-player', 'Away Player', 'GK', 2)],
  },
} as never;

describe('CourtClient realtime state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMatchSocketMock.mockReturnValue({
      score: null,
      playerStats: null,
      matchStatus: null,
      scoreFlow: [],
      statEvents: [],
      isConnected: false,
    });
  });

  it('applies live score, position, turnover, and completion updates consistently', () => {
    useMatchSocketMock.mockReturnValue({
      score: {
        matchId: 'match-1',
        homeScore: 3,
        awayScore: 4,
        currentQuarter: 2,
        currentTime: '300',
      },
      playerStats: {
        matchId: 'match-1',
        playerStats: [
          { playerId: 'home-player', currentPosition: 'GA', turnovers: 5 },
          { playerId: 'away-player', currentPosition: 'GD', turnovers: 6 },
        ],
      },
      matchStatus: {
        matchId: 'match-1',
        status: 'COMPLETED',
        quarter: 4,
        time: '0',
      },
      scoreFlow: [],
      statEvents: [],
      isConnected: true,
    });

    render(<CourtClient match={match} realtimeEnabled />);

    expect(useMatchSocketMock).toHaveBeenCalledWith('match-1', true);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
    expect(screen.getByText('3 - 4')).toBeInTheDocument();
    expect(screen.getByText('5 - 6')).toBeInTheDocument();
    expect(screen.getByTestId('court-players')).toHaveTextContent(
      'Home Player:GA|Away Player:GD',
    );
  });
});
