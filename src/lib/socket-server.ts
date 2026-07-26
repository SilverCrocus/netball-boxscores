import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  MatchStatusPayload,
  StatsUpdatePayload,
  ScoreFlowAddPayload,
  ScoreFlowSnapshotPayload,
  StatEventPayload,
  StatEventsSnapshotPayload,
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
      if (
        !requestedMatches.has(matchId)
        || !access
        || !isPublicMatchLiveOrFinal(access)
        || !access.features.finalScore.available
      ) return;

      socket.join(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} joined match:${matchId}`);

      if (access.status === 'COMPLETED') {
        // A reconnect can happen after a correction broadcast was missed.
        // Re-emit the complete canonical replacement set after the room join;
        // each emit rechecks publication, capabilities, and the revision.
        const { broadcastCompletion } = await import('@/lib/broadcasting');
        await broadcastCompletion(
          matchId,
          0,
          0,
          null,
          access.sourceUpdatedAt,
        );
      }
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
  expectedRevision?: Date | string | null,
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
  const expected = expectedRevision instanceof Date
    ? expectedRevision.toISOString()
    : expectedRevision;
  if (
    expected
    && access.sourceUpdatedAt?.toISOString() !== expected
  ) return null;
  return access;
}

function withCanonicalRevision<T extends { revision?: string }>(
  payload: T,
  access: PublicMatchAccess,
): T {
  return access.sourceUpdatedAt
    ? { ...payload, revision: access.sourceUpdatedAt.toISOString() }
    : payload;
}

export async function broadcastScoreUpdate(
  matchId: string,
  payload: ScoreUpdatePayload,
  access?: PublicMatchAccess,
  expectedRevision?: Date | string | null,
): Promise<boolean> {
  const current = await canEmit(matchId, 'FINAL_SCORE', access, expectedRevision);
  if (!current) return false;
  getIO().to(`match:${matchId}`).emit('score:update', withCanonicalRevision(payload, current));
  return true;
}

export async function broadcastMatchStatus(
  matchId: string,
  payload: MatchStatusPayload,
  access?: PublicMatchAccess,
  expectedRevision?: Date | string | null,
): Promise<boolean> {
  const current = await canEmit(matchId, 'FINAL_SCORE', access, expectedRevision);
  if (!current) return false;
  getIO().to(`match:${matchId}`).emit('match:status', withCanonicalRevision(payload, current));
  return true;
}

export async function broadcastStatsUpdate(
  matchId: string,
  payload: StatsUpdatePayload,
  access?: PublicMatchAccess,
  expectedRevision?: Date | string | null,
): Promise<boolean> {
  const current = await canEmit(matchId, 'PLAYER_BOX_SCORE', access, expectedRevision);
  if (!current) return false;
  const safePayload = current.features.lineups.available
    ? payload
    : {
        ...payload,
        playerStats: payload.playerStats.map((stats) => {
          const sanitized = { ...stats };
          delete sanitized.currentPosition;
          return sanitized;
        }),
      };
  getIO().to(`match:${matchId}`).emit(
    'stats:update',
    withCanonicalRevision(safePayload, current),
  );
  return true;
}

export async function broadcastScoreFlowAdd(
  matchId: string,
  payload: ScoreFlowAddPayload,
  access?: PublicMatchAccess,
  expectedRevision?: Date | string | null,
): Promise<boolean> {
  const current = await canEmit(matchId, 'SCORE_FLOW', access, expectedRevision);
  if (!current) return false;
  getIO().to(`match:${matchId}`).emit('scoreflow:add', withCanonicalRevision(payload, current));
  return true;
}

export async function broadcastScoreFlowSnapshot(
  matchId: string,
  payload: ScoreFlowSnapshotPayload,
  access?: PublicMatchAccess,
  expectedRevision?: Date | string | null,
): Promise<boolean> {
  const current = await canEmit(matchId, 'SCORE_FLOW', access, expectedRevision);
  if (!current) return false;
  getIO().to(`match:${matchId}`).emit(
    'scoreflow:snapshot',
    withCanonicalRevision(payload, current),
  );
  return true;
}

export async function broadcastStatEvent(
  matchId: string,
  payload: StatEventPayload,
  access?: PublicMatchAccess,
  expectedRevision?: Date | string | null,
): Promise<boolean> {
  const current = await canEmit(matchId, 'MATCH_EVENTS', access, expectedRevision);
  if (!current) return false;
  getIO().to(`match:${matchId}`).emit('stat:event', withCanonicalRevision(payload, current));
  return true;
}

export async function broadcastStatEventsSnapshot(
  matchId: string,
  payload: StatEventsSnapshotPayload,
  access?: PublicMatchAccess,
  expectedRevision?: Date | string | null,
): Promise<boolean> {
  const current = await canEmit(matchId, 'MATCH_EVENTS', access, expectedRevision);
  if (!current) return false;
  getIO().to(`match:${matchId}`).emit(
    'stat:snapshot',
    withCanonicalRevision(payload, current),
  );
  return true;
}
