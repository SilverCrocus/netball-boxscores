import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  broadcastScoreFlowDelta,
  resetScoreFlowTracking,
} from '@/lib/broadcasting';

vi.mock('@/lib/db', () => ({
  prisma: {
    player: { findMany: vi.fn() },
    scoreFlow: { findMany: vi.fn() },
  },
  excludeSimData: {},
}));

vi.mock('@/lib/socket-server', () => ({
  broadcastScoreUpdate: vi.fn(),
  broadcastMatchStatus: vi.fn(),
  broadcastStatsUpdate: vi.fn(),
  broadcastScoreFlowAdd: vi.fn(),
  broadcastStatEvent: vi.fn(),
}));

import { prisma } from '@/lib/db';
import {
  broadcastScoreFlowAdd,
} from '@/lib/socket-server';

const mockScoreFlowFindMany = vi.mocked(prisma.scoreFlow.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  resetScoreFlowTracking();
});

describe('broadcastScoreFlowDelta', () => {
  it('broadcasts all entries on first call (no prior count)', async () => {
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as any);

    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowAdd).toHaveBeenCalledTimes(2);
  });

  it('broadcasts only new entries on subsequent calls', async () => {
    // First call: 2 entries
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as any);
    await broadcastScoreFlowDelta('match-1');

    vi.mocked(broadcastScoreFlowAdd).mockClear();

    // Second call: 3 entries (1 new)
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '3', period: 1, periodSeconds: 300, scoringTeamId: 't2', homeScore: 2, awayScore: 1, scorePoints: 1, scorerPlayer: { id: 'p1', name: 'Smith' } },
    ] as any);
    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowAdd).toHaveBeenCalledTimes(1);
  });
});
