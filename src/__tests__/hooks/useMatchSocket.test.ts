import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock socket.io-client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { useMatchSocket } from '@/hooks/useMatchSocket';

describe('useMatchSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should subscribe to match room on mount', () => {
    renderHook(() => useMatchSocket('match-123'));
    expect(mockSocket.emit).toHaveBeenCalledWith('match:subscribe', {
      matchId: 'match-123',
    });
  });

  it('should register all event listeners', () => {
    renderHook(() => useMatchSocket('match-123'));
    const registeredEvents = mockSocket.on.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(registeredEvents).toContain('score:update');
    expect(registeredEvents).toContain('stats:update');
    expect(registeredEvents).toContain('match:status');
    expect(registeredEvents).toContain('scoreflow:add');
  });

  it('should unsubscribe and disconnect on unmount', () => {
    const { unmount } = renderHook(() => useMatchSocket('match-123'));
    unmount();
    expect(mockSocket.emit).toHaveBeenCalledWith('match:unsubscribe', {
      matchId: 'match-123',
    });
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should update score state on score:update event', () => {
    renderHook(() => useMatchSocket('match-123'));

    const scoreHandler = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'score:update'
    )?.[1];

    expect(scoreHandler).toBeDefined();
  });

  it('should register connect and disconnect listeners', () => {
    renderHook(() => useMatchSocket('match-123'));
    const registeredEvents = mockSocket.on.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(registeredEvents).toContain('connect');
    expect(registeredEvents).toContain('disconnect');
  });

  it('should clean up all event listeners on unmount', () => {
    const { unmount } = renderHook(() => useMatchSocket('match-123'));
    unmount();
    const removedEvents = mockSocket.off.mock.calls.map(
      (call: unknown[]) => call[0]
    );
    expect(removedEvents).toContain('score:update');
    expect(removedEvents).toContain('stats:update');
    expect(removedEvents).toContain('match:status');
    expect(removedEvents).toContain('scoreflow:add');
  });
});
