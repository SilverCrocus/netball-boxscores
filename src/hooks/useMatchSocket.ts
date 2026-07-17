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
  hasPlayerStatsSnapshot: boolean;
  hasScoreFlowSnapshot: boolean;
  hasStatEventsSnapshot: boolean;
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
  hasPlayerStatsSnapshot: false,
  hasScoreFlowSnapshot: false,
  hasStatEventsSnapshot: false,
  isConnected: false,
};

export function useMatchSocket(matchId: string, enabled = false): MatchSocketState {
  const socketRef = useRef<TypedSocket | null>(null);
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
          hasPlayerStatsSnapshot: true,
        }));
      }
    });

    socket.on('match:status', (payload) => {
      if (payload.matchId === matchId && acceptsRevision(payload.revision)) {
        setState((prev) => ({
          ...(prev.matchId === matchId ? prev : { matchId, ...EMPTY_SOCKET_STATE }),
          matchStatus: payload,
        }));

        // Keep the public subscription alive after completion. Official score
        // corrections and heuristic reopenings can arrive well after the old
        // two-second cutoff, and reconnect re-subscribes to a canonical final.
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
          hasScoreFlowSnapshot: true,
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
          hasStatEventsSnapshot: true,
        }));
      }
    });

    return () => {
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
