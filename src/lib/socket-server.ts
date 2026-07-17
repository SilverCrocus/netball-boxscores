import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  MatchStatusPayload,
  StatsUpdatePayload,
  ScoreFlowAddPayload,
  StatEventPayload,
} from '@/types/socket';
import type { DataCapability } from '@prisma/client';
import {
  hasPublicMatchCapability,
  isPublicMatchLiveOrFinal,
  resolvePublicMatchAccess,
  type PublicMatchAccess,
} from '@/lib/public-match';

let io: SocketServer<ClientToServerEvents, ServerToClientEvents> | null = null;

export function initSocketServer(httpServer: HttpServer) {
  io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      path: '/api/socketio',
      cors: {
        origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
      },
    }
  );

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);
    const requestedMatches = new Set<string>();

    socket.on('match:subscribe', async (data) => {
      const matchId = data?.matchId;
      if (typeof matchId !== 'string' || matchId.length === 0 || matchId.length > 128) return;
      for (const existingMatchId of requestedMatches) {
        if (existingMatchId !== matchId) socket.leave(`match:${existingMatchId}`);
      }
      requestedMatches.clear();
      requestedMatches.add(matchId);

      const access = await resolvePublicMatchAccess(matchId).catch(() => null);
      const hasRealtimeDetail = access?.features.playerBoxScore.available
        || access?.features.scoreFlow.available
        || access?.features.matchEvents.available;
      if (
        !requestedMatches.has(matchId)
        || !access
        || access.status !== 'LIVE'
        || !access.features.finalScore.available
        || !hasRealtimeDetail
      ) return;

      socket.join(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} joined match:${matchId}`);
    });

    socket.on('match:unsubscribe', (data) => {
      const matchId = data?.matchId;
      if (typeof matchId !== 'string' || matchId.length === 0 || matchId.length > 128) return;
      requestedMatches.delete(matchId);
      socket.leave(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} left match:${matchId}`);
    });

    socket.on('disconnect', () => {
      requestedMatches.clear();
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initSocketServer first.');
  }
  return io;
}

async function canEmit(
  matchId: string,
  capability: DataCapability,
  providedAccess?: PublicMatchAccess,
): Promise<PublicMatchAccess | null> {
  // A caller-supplied snapshot can become stale while persistence or other
  // awaited work is in flight. Resolve again at the final emit boundary so an
  // unpublish or capability revocation takes effect before Socket.IO sees data.
  void providedAccess;
  const access = await resolvePublicMatchAccess(matchId).catch(() => null);
  if (
    !access
    || !isPublicMatchLiveOrFinal(access)
    || !hasPublicMatchCapability(access, capability)
  ) return null;
  return access;
}

export async function broadcastScoreUpdate(
  matchId: string,
  payload: ScoreUpdatePayload,
  access?: PublicMatchAccess,
): Promise<boolean> {
  if (!await canEmit(matchId, 'FINAL_SCORE', access)) return false;
  getIO().to(`match:${matchId}`).emit('score:update', payload);
  return true;
}

export async function broadcastMatchStatus(
  matchId: string,
  payload: MatchStatusPayload,
  access?: PublicMatchAccess,
): Promise<boolean> {
  if (!await canEmit(matchId, 'FINAL_SCORE', access)) return false;
  getIO().to(`match:${matchId}`).emit('match:status', payload);
  return true;
}

export async function broadcastStatsUpdate(
  matchId: string,
  payload: StatsUpdatePayload,
  access?: PublicMatchAccess,
): Promise<boolean> {
  if (!await canEmit(matchId, 'PLAYER_BOX_SCORE', access)) return false;
  getIO().to(`match:${matchId}`).emit('stats:update', payload);
  return true;
}

export async function broadcastScoreFlowAdd(
  matchId: string,
  payload: ScoreFlowAddPayload,
  access?: PublicMatchAccess,
): Promise<boolean> {
  if (!await canEmit(matchId, 'SCORE_FLOW', access)) return false;
  getIO().to(`match:${matchId}`).emit('scoreflow:add', payload);
  return true;
}

export async function broadcastStatEvent(
  matchId: string,
  payload: StatEventPayload,
  access?: PublicMatchAccess,
): Promise<boolean> {
  if (!await canEmit(matchId, 'MATCH_EVENTS', access)) return false;
  getIO().to(`match:${matchId}`).emit('stat:event', payload);
  return true;
}
