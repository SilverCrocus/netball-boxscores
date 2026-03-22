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
} from '@/types/socket';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MatchSocketState {
  score: ScoreUpdatePayload | null;
  playerStats: StatsUpdatePayload | null;
  matchStatus: MatchStatusPayload | null;
  scoreFlow: ScoreFlowAddPayload[];
  isConnected: boolean;
}

export function useMatchSocket(matchId: string) {
  const socketRef = useRef<TypedSocket | null>(null);
  const [state, setState] = useState<MatchSocketState>({
    score: null,
    playerStats: null,
    matchStatus: null,
    scoreFlow: [],
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

    socket.on('connect' as any, () => {
      setState((prev) => ({ ...prev, isConnected: true }));
      socket.emit('match:subscribe', { matchId });
    });

    socket.on('disconnect' as any, () => {
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
      }
    });

    socket.on('scoreflow:add', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({
          ...prev,
          scoreFlow: [...prev.scoreFlow, payload],
        }));
      }
    });

    // Subscribe to match room
    socket.emit('match:subscribe', { matchId });

    return () => {
      socket.emit('match:unsubscribe', { matchId });
      socket.off('score:update');
      socket.off('stats:update');
      socket.off('match:status');
      socket.off('scoreflow:add');
      socket.disconnect();
    };
  }, [matchId]);

  return state;
}
