import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StatsUpdatePayload, ScoreFlowAddPayload } from '@/types/socket';

// Mock socket.io Server
const mockEmit = vi.fn();
const mockTo = vi.fn(() => ({ emit: mockEmit }));
const mockOn = vi.fn();

vi.mock('socket.io', () => {
  return {
    Server: class {
      on = mockOn;
      to = mockTo;
    },
  };
});

// Must import after mocks
import { initSocketServer, broadcastStatsUpdate, broadcastScoreFlowAdd } from '@/lib/socket-server';
import { createServer } from 'http';

describe('socket-server broadcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize the socket server so getIO() works
    const httpServer = createServer();
    initSocketServer(httpServer);
  });

  it('broadcastStatsUpdate emits stats:update to match room', () => {
    const payload: StatsUpdatePayload = {
      matchId: 'match-1',
      playerStats: [{
        playerId: 'player-1',
        goals: 5,
        attempts: 7,
        goalAssists: 2,
        intercepts: 0,
        deflections: 0,
        rebounds: 0,
        penalties: 1,
        feeds: 3,
        centrePassReceives: 0,
        turnovers: 1,
        minutesPlayed: 30,
      }],
    };

    broadcastStatsUpdate('match-1', payload);

    expect(mockTo).toHaveBeenCalledWith('match:match-1');
    expect(mockEmit).toHaveBeenCalledWith('stats:update', payload);
  });

  it('broadcastScoreFlowAdd emits scoreflow:add to match room', () => {
    const payload: ScoreFlowAddPayload = {
      matchId: 'match-1',
      period: 2,
      periodSeconds: 450,
      scoringTeamId: 'team-1',
      homeScore: 30,
      awayScore: 28,
    };

    broadcastScoreFlowAdd('match-1', payload);

    expect(mockTo).toHaveBeenCalledWith('match:match-1');
    expect(mockEmit).toHaveBeenCalledWith('scoreflow:add', payload);
  });
});
