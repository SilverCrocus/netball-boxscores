import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Mock socket.io-client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
  io: { opts: { reconnection: true } },
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { useMatchSocket } from '@/hooks/useMatchSocket';
import { io } from 'socket.io-client';

describe('useMatchSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.io.opts.reconnection = true;
  });

  it('creates no socket unless realtime was explicitly enabled', () => {
    const { result } = renderHook(() => useMatchSocket('match-123'));

    expect(io).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      score: null,
      isConnected: false,
      scoreFlow: [],
      statEvents: [],
    });
  });

  it('should subscribe to match room on connect', () => {
    renderHook(() => useMatchSocket('match-123', true));

    // Find the connect handler and trigger it
    const connectCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'connect'
    );
    expect(connectCall).toBeDefined();
    const connectHandler = connectCall![1] as () => void;
    connectHandler();

    expect(mockSocket.emit).toHaveBeenCalledWith('match:subscribe', {
      matchId: 'match-123',
    });
  });

  it('should register all event listeners', () => {
    renderHook(() => useMatchSocket('match-123', true));
    const registeredEvents = mockSocket.on.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(registeredEvents).toContain('score:update');
    expect(registeredEvents).toContain('stats:update');
    expect(registeredEvents).toContain('match:status');
    expect(registeredEvents).toContain('scoreflow:add');
    expect(registeredEvents).toContain('scoreflow:snapshot');
    expect(registeredEvents).toContain('stat:event');
    expect(registeredEvents).toContain('stat:snapshot');
  });

  it('should unsubscribe and disconnect on unmount', () => {
    const { unmount } = renderHook(() => useMatchSocket('match-123', true));
    unmount();
    expect(mockSocket.emit).toHaveBeenCalledWith('match:unsubscribe', {
      matchId: 'match-123',
    });
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should update score state on score:update event', () => {
    renderHook(() => useMatchSocket('match-123', true));

    const scoreHandler = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'score:update'
    )?.[1];

    expect(scoreHandler).toBeDefined();
  });

  it('should register connect and disconnect listeners', () => {
    renderHook(() => useMatchSocket('match-123', true));
    const registeredEvents = mockSocket.on.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(registeredEvents).toContain('connect');
    expect(registeredEvents).toContain('disconnect');
  });

  it('keeps simultaneous scores by opposing teams and deduplicates exact repeats', () => {
    const { result } = renderHook(() => useMatchSocket('match-123', true));
    const scoreFlowHandler = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'scoreflow:add',
    )?.[1] as (payload: Record<string, unknown>) => void;
    const base = {
      matchId: 'match-123',
      period: 2,
      periodSeconds: 301,
      scorePoints: 1,
    };

    act(() => {
      scoreFlowHandler({ ...base, scoringTeamId: 'home-team', homeScore: 20, awayScore: 19 });
      scoreFlowHandler({ ...base, scoringTeamId: 'away-team', homeScore: 20, awayScore: 20 });
      scoreFlowHandler({ ...base, scoringTeamId: 'home-team', homeScore: 20, awayScore: 19 });
    });

    expect(result.current.scoreFlow.map((entry) => entry.scoringTeamId)).toEqual([
      'home-team',
      'away-team',
    ]);

    act(() => {
      scoreFlowHandler({ ...base, scoringTeamId: 'home-team', homeScore: 21, awayScore: 19, scorePoints: 2 });
      scoreFlowHandler({ ...base, scoringTeamId: 'away-team', homeScore: 21, awayScore: 20 });
    });

    expect(result.current.scoreFlow).toHaveLength(2);
    expect(result.current.scoreFlow[0]).toMatchObject({
      scoringTeamId: 'home-team',
      homeScore: 21,
      scorePoints: 2,
    });
    expect(result.current.scoreFlow[1]).toMatchObject({
      scoringTeamId: 'away-team',
      homeScore: 21,
      awayScore: 20,
    });
  });

  it('deduplicates replayed stat events by canonical id without collapsing same-second events', () => {
    const { result } = renderHook(() => useMatchSocket('match-123', true));
    const statEventHandler = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'stat:event',
    )?.[1] as (payload: Record<string, unknown>) => void;
    const base = {
      matchId: 'match-123',
      type: 'intercept',
      playerId: 'player-1',
      playerName: 'Player One',
      teamId: 'home',
      teamName: 'Home',
      teamAbbreviation: 'HOM',
      isHomeTeam: true,
      quarter: 2,
      time: '301',
    };

    act(() => {
      statEventHandler({ ...base, eventId: 'event-1' });
      statEventHandler({ ...base, eventId: 'event-1' });
      statEventHandler({ ...base, eventId: 'event-2' });
    });

    expect(result.current.statEvents.map((event) => event.eventId)).toEqual([
      'event-1',
      'event-2',
    ]);
  });

  it('rejects an older stat delta after a newer canonical event snapshot', () => {
    const { result } = renderHook(() => useMatchSocket('match-123', true));
    const handler = (event: string) => mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === event,
    )?.[1] as (payload: Record<string, unknown>) => void;

    act(() => {
      handler('stat:snapshot')({
        matchId: 'match-123', events: [], revision: '2026-07-25T09:00:02Z',
      });
      handler('stat:event')({
        eventId: 'event-r1', matchId: 'match-123', type: 'intercept',
        playerId: 'player-1', playerName: 'Player One', teamId: 'home',
        teamName: 'Home', teamAbbreviation: 'HOM', isHomeTeam: true,
        quarter: 2, time: '299', revision: '2026-07-25T09:00:01Z',
      });
    });

    expect(result.current.statEvents).toEqual([]);
  });

  it('stays subscribed past completion and receives a reopen after a network reconnect', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useMatchSocket('match-123', true));
      const handler = (event: string) => mockSocket.on.mock.calls.find(
        (call: unknown[]) => call[0] === event,
      )?.[1] as (payload: Record<string, unknown>) => void;

      act(() => {
        handler('connect')({});
        handler('match:status')({
          matchId: 'match-123', status: 'COMPLETED', quarter: 4, time: '0',
          revision: '2026-07-25T09:00:01Z',
        });
        vi.advanceTimersByTime(30_000);
        handler('disconnect')({});
        handler('connect')({});
        handler('match:status')({
          matchId: 'match-123', status: 'LIVE', quarter: 4, time: '899',
          revision: '2026-07-25T09:00:02Z',
        });
      });

      expect(mockSocket.disconnect).not.toHaveBeenCalled();
      expect(mockSocket.io.opts.reconnection).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
      expect(result.current.matchStatus).toMatchObject({ status: 'LIVE' });
      expect(result.current.isConnected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces score-flow and stat-event collections from canonical snapshots', () => {
    const { result } = renderHook(() => useMatchSocket('match-123', true));
    const handler = (event: string) => mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === event,
    )?.[1] as (payload: Record<string, unknown>) => void;
    const revision = '2026-07-25T09:00:02Z';

    act(() => {
      handler('scoreflow:add')({
        matchId: 'match-123', period: 1, periodSeconds: 100,
        scoringTeamId: 'home', homeScore: 1, awayScore: 0, scorePoints: 1,
      });
      handler('stat:event')({
        eventId: 'removed-event', matchId: 'match-123', type: 'intercept',
        playerId: 'player-1', playerName: 'Player One', teamId: 'home',
        teamName: 'Home', teamAbbreviation: 'HOM', isHomeTeam: true,
        quarter: 1, time: '100',
      });
      handler('scoreflow:snapshot')({ matchId: 'match-123', entries: [], revision });
      handler('stat:snapshot')({ matchId: 'match-123', events: [], revision });
    });

    expect(result.current.scoreFlow).toEqual([]);
    expect(result.current.statEvents).toEqual([]);
    expect(result.current.hasScoreFlowSnapshot).toBe(true);
    expect(result.current.hasStatEventsSnapshot).toBe(true);
  });

  it('never lets an older or unversioned payload regress an observed canonical revision', () => {
    const { result } = renderHook(() => useMatchSocket('match-123', true));
    const handler = (event: string) => mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === event,
    )?.[1] as (payload: Record<string, unknown>) => void;
    const newer = '2026-07-25T09:00:02.000Z';
    const older = '2026-07-25T09:00:01.000Z';

    act(() => {
      handler('score:update')({
        matchId: 'match-123',
        homeScore: 20,
        awayScore: 19,
        currentQuarter: 2,
        currentTime: '300',
        revision: newer,
      });
      handler('score:update')({
        matchId: 'match-123',
        homeScore: 18,
        awayScore: 19,
        currentQuarter: 2,
        currentTime: '250',
        revision: older,
      });
      handler('score:update')({
        matchId: 'match-123',
        homeScore: 1,
        awayScore: 0,
        currentQuarter: 1,
        currentTime: '10',
      });
      handler('stats:update')({
        matchId: 'match-123',
        playerStats: [{ playerId: 'player-1', goals: 20 }],
        revision: newer,
      });
      handler('stats:update')({
        matchId: 'match-123',
        playerStats: [{ playerId: 'player-1', goals: 18 }],
        revision: older,
      });
      handler('match:status')({
        matchId: 'match-123',
        status: 'COMPLETED',
        quarter: 4,
        time: '0',
        revision: newer,
      });
      handler('match:status')({
        matchId: 'match-123',
        status: 'LIVE',
        quarter: 4,
        time: '899',
        revision: older,
      });
    });

    expect(result.current.score).toMatchObject({ homeScore: 20, awayScore: 19 });
    expect(result.current.playerStats).toMatchObject({
      playerStats: [{ playerId: 'player-1', goals: 20 }],
    });
    expect(result.current.matchStatus).toMatchObject({ status: 'COMPLETED' });
  });

  it('accepts all payload types that share the same canonical revision', () => {
    const { result } = renderHook(() => useMatchSocket('match-123', true));
    const handler = (event: string) => mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === event,
    )?.[1] as (payload: Record<string, unknown>) => void;
    const revision = '2026-07-25T09:00:02.000Z';

    act(() => {
      handler('score:update')({
        matchId: 'match-123',
        homeScore: 20,
        awayScore: 19,
        currentQuarter: 2,
        currentTime: '300',
        revision,
      });
      handler('stats:update')({
        matchId: 'match-123',
        playerStats: [{ playerId: 'player-1', goals: 20 }],
        revision,
      });
      handler('scoreflow:add')({
        matchId: 'match-123',
        period: 2,
        periodSeconds: 300,
        scoringTeamId: 'home',
        homeScore: 20,
        awayScore: 19,
        scorePoints: 1,
        revision,
      });
    });

    expect(result.current.score?.revision).toBe(revision);
    expect(result.current.playerStats?.revision).toBe(revision);
    expect(result.current.scoreFlow[0]?.revision).toBe(revision);
  });

  it('should clean up all event listeners on unmount', () => {
    const { unmount } = renderHook(() => useMatchSocket('match-123', true));
    unmount();
    const removedEvents = mockSocket.off.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(removedEvents).toContain('connect');
    expect(removedEvents).toContain('disconnect');
    expect(removedEvents).toContain('score:update');
    expect(removedEvents).toContain('stats:update');
    expect(removedEvents).toContain('match:status');
    expect(removedEvents).toContain('scoreflow:add');
    expect(removedEvents).toContain('scoreflow:snapshot');
    expect(removedEvents).toContain('stat:event');
    expect(removedEvents).toContain('stat:snapshot');
  });

  it('resets state immediately when the match id changes', () => {
    const { result, rerender } = renderHook(
      ({ matchId }) => useMatchSocket(matchId, true),
      { initialProps: { matchId: 'match-123' } },
    );
    const scoreHandler = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'score:update',
    )?.[1] as (payload: Record<string, unknown>) => void;

    act(() => {
      scoreHandler({
        matchId: 'match-123',
        homeScore: 50,
        awayScore: 49,
        currentQuarter: 4,
        currentTime: '10',
      });
    });
    expect(result.current.score).toMatchObject({ homeScore: 50 });

    rerender({ matchId: 'match-456' });

    expect(result.current).toMatchObject({
      score: null,
      playerStats: null,
      matchStatus: null,
      scoreFlow: [],
      statEvents: [],
      isConnected: false,
    });
  });
});
