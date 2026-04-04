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

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MatchSocketState {
  score: ScoreUpdatePayload | null;
  playerStats: StatsUpdatePayload | null;
  matchStatus: MatchStatusPayload | null;
  scoreFlow: ScoreFlowAddPayload[];
  statEvents: StatEventPayload[];
  isConnected: boolean;
}

export function useMatchSocket(matchId: string): MatchSocketState {
  const socketRef = useRef<TypedSocket | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<MatchSocketState>({
    score: null,
    playerStats: null,
    matchStatus: null,
    scoreFlow: [],
    statEvents: [],
    isConnected: false,
  });

  useEffect(() => {
    const socket: TypedSocket = io({
      path: '/api/socketio',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setState((prev) => ({ ...prev, isConnected: true }));
      socket.emit('match:subscribe', { matchId });
    });

    socket.on('disconnect', () => {
      setState((prev) => ({ ...prev, isConnected: false }));
    });

    socket.on('score:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, score: payload }));
      }
    });

    socket.on('stats:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, playerStats: payload }));
      }
    });

    socket.on('match:status', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, matchStatus: payload }));

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
          // Deduplicate by period+periodSeconds
          const key = `${payload.period}-${payload.periodSeconds}`;
          const exists = prev.scoreFlow.some(
            (sf) => `${sf.period}-${sf.periodSeconds}` === key,
          );
          if (exists) return prev;
          return { ...prev, scoreFlow: [...prev.scoreFlow, payload] };
        });
      }
    });

    socket.on('stat:event', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({
          ...prev,
          statEvents: [...prev.statEvents, payload],
        }));
      }
    });

    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
      socket.emit('match:unsubscribe', { matchId });
      socket.off('score:update');
      socket.off('stats:update');
      socket.off('match:status');
      socket.off('scoreflow:add');
      socket.off('stat:event');
      socket.disconnect();
    };
  }, [matchId]);

  return state;
}
