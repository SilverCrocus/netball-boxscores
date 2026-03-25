import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  MatchStatusPayload,
} from '@/types/socket';

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

    socket.on('match:subscribe', ({ matchId }) => {
      socket.join(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} joined match:${matchId}`);
    });

    socket.on('match:unsubscribe', ({ matchId }) => {
      socket.leave(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} left match:${matchId}`);
    });

    socket.on('disconnect', () => {
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

export function broadcastScoreUpdate(matchId: string, payload: ScoreUpdatePayload) {
  getIO().to(`match:${matchId}`).emit('score:update', payload);
}

export function broadcastMatchStatus(matchId: string, payload: MatchStatusPayload) {
  getIO().to(`match:${matchId}`).emit('match:status', payload);
}

