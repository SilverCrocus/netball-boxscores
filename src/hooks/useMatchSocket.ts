'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  StatsUpdatePayload,
  MatchStatusPayload,
  ScoreFlowAddPayload,
  StatEventPayload,
} from '@/types/socket';
import { mergeScoreFlows } from '@/lib/score-flow';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MatchSocketState {
  score: ScoreUpdatePayload | null;
  playerStats: StatsUpdatePayload | null;
  matchStatus: MatchStatusPayload | null;
  scoreFlow: ScoreFlowAddPayload[];
  statEvents: StatEventPayload[];
  isConnected: boolean;
}

interface InternalMatchSocketState extends MatchSocketState {
  matchId: string;
}

const EMPTY_SOCKET_STATE: MatchSocketState = {
  score: null,
  playerStats: null,
  matchStatus: null,
  scoreFlow: [],
  statEvents: [],
  isConnected: false,
};

export function useMatchSocket(matchId: string, enabled = false): MatchSocketState {
  const socketRef = useRef<TypedSocket | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<InternalMatchSocketState>({
    matchId,
    ...EMPTY_SOCKET_STATE,
  });

  useEffect(() => {
    if (!enabled) return;

    const socket: TypedSocket = io({
      path: '/api/socketio',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setState((prev) => ({
        ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
        isConnected: true,
      }));
      socket.emit('match:subscribe', { matchId });
    });

    socket.on('disconnect', () => {
      setState((prev) => prev.matchId === matchId
        ? { ...prev, isConnected: false }
        : prev);
    });

    socket.on('score:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          score: payload,
        }));
      }
    });

    socket.on('stats:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          playerStats: payload,
        }));
      }
    });

    socket.on('match:status', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          matchStatus: payload,
        }));

        if (payload.status === 'COMPLETED') {
          completionTimeoutRef.current = setTimeout(() => {
            socket.io.opts.reconnection = false;
            socket.disconnect();
          }, 2000);
        }
      }
    });

    socket.on('scoreflow:add', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => {
          const current = prev.matchId === matchId
            ? prev
            : { matchId, ...EMPTY_SOCKET_STATE };
          return { ...current, scoreFlow: mergeScoreFlows(current.scoreFlow, [payload]) };
        });
      }
    });

    socket.on('stat:event', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => {
          const current = prev.matchId === matchId
            ? prev
            : { matchId, ...EMPTY_SOCKET_STATE };
          if (current.statEvents.some((event) => event.eventId === payload.eventId)) {
            return current;
          }
          return { ...current, statEvents: [...current.statEvents, payload] };
        });
      }
    });

    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
      socket.emit('match:unsubscribe', { matchId });
      socket.off('connect');
      socket.off('disconnect');
      socket.off('score:update');
      socket.off('stats:update');
      socket.off('match:status');
      socket.off('scoreflow:add');
      socket.off('stat:event');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, matchId]);

  if (!enabled || state.matchId !== matchId) return EMPTY_SOCKET_STATE;
  return state;
}
