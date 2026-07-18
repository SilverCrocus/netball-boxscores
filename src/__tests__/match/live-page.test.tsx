import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// Mock the useMatchSocket hook
const socketState = vi.hoisted(() => ({
  current: {
    score: null,
    playerStats: null,
    matchStatus: null,
    scoreFlow: [],
    statEvents: [],
    hasPlayerStatsSnapshot: false,
    hasScoreFlowSnapshot: false,
    hasStatEventsSnapshot: false,
    isConnected: false,
  } as Record<string, unknown>,
}));

vi.mock('@/hooks/useMatchSocket', () => ({
  useMatchSocket: vi.fn(() => socketState.current),
}));

const emptySocketState = () => ({
  score: null,
  playerStats: null,
  matchStatus: null,
  scoreFlow: [],
  statEvents: [],
  hasPlayerStatsSnapshot: false,
  hasScoreFlowSnapshot: false,
  hasStatEventsSnapshot: false,
  isConnected: false,
});

import { LiveGameClient } from '@/app/match/[matchId]/live/LiveGameClient';

const mockMatch = {
  id: 'match-1',
  competitionId: 'ssn-2026',
  round: 5,
  venue: 'Melbourne Arena',
  status: 'LIVE',
  homeScore: 42,
  awayScore: 38,
  currentQuarter: 3,
  currentTime: '12:45',
  homeTeam: {
    id: 'team-1',
    name: 'Viper Hawks',
    abbreviation: 'VH',
    logoUrl: null,
    players: [
      {
        id: 'p1',
        name: 'Sarah Jenkins',
        position: 'GS',
        goals: 18,
        attempts: 20,
        goalAssists: 0,
        intercepts: 0,
        deflections: 0,
        rebounds: 2,
        penalties: 0,
        feeds: 0,
        centrePassReceives: 0,
        turnovers: 1,
        minutesPlayed: 30,
      },
      {
        id: 'p2',
        name: 'Jessica Chen',
        position: 'C',
        goals: 0,
        attempts: 0,
        goalAssists: 5,
        intercepts: 2,
        deflections: 1,
        rebounds: 0,
        penalties: 0,
        feeds: 18,
        centrePassReceives: 0,
        turnovers: 3,
        minutesPlayed: 30,
      },
    ],
  },
  awayTeam: {
    id: 'team-2',
    name: 'Nova Stars',
    abbreviation: 'NS',
    logoUrl: null,
    players: [
      {
        id: 'p3',
        name: 'Linda Blair',
        position: 'GS',
        goals: 22,
        attempts: 24,
        goalAssists: 0,
        intercepts: 0,
        deflections: 0,
        rebounds: 1,
        penalties: 0,
        feeds: 0,
        centrePassReceives: 0,
        turnovers: 2,
        minutesPlayed: 30,
      },
    ],
  },
  quarters: [
    { quarter: 1, homeScore: 14, awayScore: 12 },
    { quarter: 2, homeScore: 16, awayScore: 14 },
  ],
};

describe('LiveGameClient', () => {
  beforeEach(() => {
    socketState.current = emptySocketState();
  });

  it('should render both team names', () => {
    render(<LiveGameClient match={mockMatch} />);
    expect(screen.getAllByText('Viper Hawks').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nova Stars').length).toBeGreaterThan(0);
  });

  it('should render the score', () => {
    render(<LiveGameClient match={mockMatch} />);
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
    expect(screen.getAllByText('38').length).toBeGreaterThan(0);
  });

  it('should render player names in lineups', () => {
    render(<LiveGameClient match={mockMatch} />);
    expect(screen.getAllByText('Sarah Jenkins').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jessica Chen').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Linda Blair').length).toBeGreaterThan(0);
  });

  it('should preserve the canonical edition in live player links', () => {
    render(<LiveGameClient match={mockMatch} />);
    for (const link of screen.getAllByRole('link', { name: 'Sarah Jenkins' })) {
      expect(link).toHaveAttribute('href', '/player/p1?edition=ssn-2026');
    }
  });

  it('should render Key Match Stats section', () => {
    render(<LiveGameClient match={mockMatch} />);
    expect(screen.getByText('Key Match Stats')).toBeInTheDocument();
  });

  it('should render Live Feed section', () => {
    render(<LiveGameClient match={mockMatch} />);
    expect(screen.getByText('Live Feed')).toBeInTheDocument();
  });

  it('should render Live Lineups section', () => {
    render(<LiveGameClient match={mockMatch} />);
    expect(screen.getByText('Live Lineups')).toBeInTheDocument();
  });

  it('should render round and venue info', () => {
    render(<LiveGameClient match={mockMatch} />);
    const roundText = screen.getByText(/Round 5/);
    expect(roundText).toBeInTheDocument();
  });

  it('treats empty canonical snapshots as tombstones for SSR collections and stats', () => {
    socketState.current = {
      ...emptySocketState(),
      playerStats: { matchId: 'match-1', playerStats: [] },
      hasPlayerStatsSnapshot: true,
      hasScoreFlowSnapshot: true,
      hasStatEventsSnapshot: true,
    };
    render(<LiveGameClient match={{
      ...mockMatch,
      initialScoreFlow: [{
        matchId: 'match-1', period: 1, periodSeconds: 10,
        scoringTeamId: 'team-1', homeScore: 1, awayScore: 0,
        scorePoints: 1, scorerPlayerId: 'p1', scorerName: 'Stale Scorer',
      }],
      initialMatchEvents: [{
        eventId: 'stale-event', type: 'intercept', period: 1, periodSeconds: 20,
        playerId: 'p2', playerName: 'Stale Defender', teamId: 'team-1',
        teamName: 'Viper Hawks', teamAbbreviation: 'VH', teamLogoUrl: null,
      }],
    }} realtimeEnabled />);

    expect(screen.queryByText('Stale Scorer')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale Defender')).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for live events...')).toBeInTheDocument();
    const playerRow = screen.getAllByRole('link', { name: 'Sarah Jenkins' })[0].closest('tr');
    expect(playerRow).not.toBeNull();
    expect(within(playerRow!).getAllByRole('cell').slice(1).map((cell) => cell.textContent))
      .toEqual(['0', '0', '0', '0', '0']);
  });

  it('replaces SSR flow, events, and player values with a downward canonical snapshot', () => {
    socketState.current = {
      ...emptySocketState(),
      playerStats: {
        matchId: 'match-1',
        playerStats: [{
          playerId: 'p1', goals: 5, attempts: 6, goalAssists: 0,
          intercepts: 0, deflections: 0, rebounds: 0, penalties: 0,
          feeds: 0, centrePassReceives: 0, turnovers: 0, minutesPlayed: 10,
        }],
      },
      scoreFlow: [{
        matchId: 'match-1', period: 1, periodSeconds: 30,
        scoringTeamId: 'team-2', homeScore: 0, awayScore: 1,
        scorePoints: 1, scorerPlayerId: 'p3', scorerName: 'Canonical Scorer',
      }],
      statEvents: [{
        eventId: 'canonical-event', matchId: 'match-1', type: 'turnover',
        playerId: 'p3', playerName: 'Canonical Defender', teamId: 'team-2',
        teamName: 'Nova Stars', teamAbbreviation: 'NS', isHomeTeam: false,
        quarter: 1, time: '40',
      }],
      hasPlayerStatsSnapshot: true,
      hasScoreFlowSnapshot: true,
      hasStatEventsSnapshot: true,
    };
    render(<LiveGameClient match={{
      ...mockMatch,
      initialScoreFlow: [{
        matchId: 'match-1', period: 1, periodSeconds: 10,
        scoringTeamId: 'team-1', homeScore: 1, awayScore: 0,
        scorePoints: 1, scorerPlayerId: 'p1', scorerName: 'Stale Scorer',
      }],
      initialMatchEvents: [{
        eventId: 'stale-event', type: 'intercept', period: 1, periodSeconds: 20,
        playerId: 'p2', playerName: 'Stale Defender', teamId: 'team-1',
        teamName: 'Viper Hawks', teamAbbreviation: 'VH', teamLogoUrl: null,
      }],
    }} realtimeEnabled />);

    expect(screen.queryByText('Stale Scorer')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale Defender')).not.toBeInTheDocument();
    expect(screen.getByText('Canonical Scorer')).toBeInTheDocument();
    expect(screen.getByText('Canonical Defender')).toBeInTheDocument();
    const playerRow = screen.getAllByRole('link', { name: 'Sarah Jenkins' })[0].closest('tr');
    expect(within(playerRow!).getAllByRole('cell')[1]).toHaveTextContent('5');
    const absentPlayerRow = screen.getAllByRole('link', { name: 'Jessica Chen' })[0].closest('tr');
    expect(within(absentPlayerRow!).getAllByRole('cell').slice(1).map((cell) => cell.textContent))
      .toEqual(['0', '0', '0', '0', '0']);
  });
});
