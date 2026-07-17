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
  const latestRevisionRef = useRef<{ matchId: string; revision: number | null }>({
    matchId,
    revision: null,
  });
  const [state, setState] = useState<InternalMatchSocketState>({
    matchId,
    ...EMPTY_SOCKET_STATE,
  });

  useEffect(() => {
    if (!enabled) return;
    latestRevisionRef.current = { matchId, revision: null };

    const acceptsRevision = (revision?: string): boolean => {
      const latest = latestRevisionRef.current.matchId === matchId
        ? latestRevisionRef.current.revision
        : null;
      if (!revision) {
        // Backward compatible while connected to an older server. Once this
        // client has observed an ordered payload, an unversioned payload can no
        // longer safely overwrite it during a rolling deploy.
        return latest === null;
      }
      const candidate = Date.parse(revision);
      if (!Number.isFinite(candidate) || (latest !== null && candidate < latest)) {
        return false;
      }
      if (latest === null || candidate > latest) {
        latestRevisionRef.current = { matchId, revision: candidate };
      }
      // Equal revisions are intentionally accepted: score, status, stats and
      // event payloads from one canonical snapshot share the same token.
      return true;
    };

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
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          score: payload,
        }));
      }
    });

    socket.on('stats:update', (payload) => {
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          playerStats: payload,
        }));
      }
    });

    socket.on('match:status', (payload) => {
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          matchStatus: payload,
        }));

        if (payload.status === 'COMPLETED') {
          if (completionTimeoutRef.current) {
            clearTimeout(completionTimeoutRef.current);
          }
          completionTimeoutRef.current = setTimeout(() => {
            socket.io.opts.reconnection = false;
            socket.disconnect();
          }, 2000);
        } else if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current);
          completionTimeoutRef.current = null;
        }
      }
    });

    socket.on('scoreflow:add', (payload) => {
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
        setState((prev) => {
          const current = prev.matchId === matchId
            ? prev
            : { matchId, ...EMPTY_SOCKET_STATE };
          return { ...current, scoreFlow: mergeScoreFlows(current.scoreFlow, [payload]) };
        });
      }
    });

    socket.on('scoreflow:snapshot', (payload) => {
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          scoreFlow: payload.entries,
        }));
      }
    });

    socket.on('stat:event', (payload) => {
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
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

    socket.on('stat:snapshot', (payload) => {
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          statEvents: payload.events,
        }));
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
      socket.off('scoreflow:snapshot');
      socket.off('stat:event');
      socket.off('stat:snapshot');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, matchId]);

  if (!enabled || state.matchId !== matchId) return EMPTY_SOCKET_STATE;
  return state;
}
