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
    expect(registeredEvents).toContain('stat:event');
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
    expect(removedEvents).toContain('stat:event');
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
