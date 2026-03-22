import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const expressApp = express();
  const httpServer = createServer(expressApp);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: dev ? "http://localhost:3000" : process.env.NEXTAUTH_URL,
      methods: ["GET", "POST"],
    },
  });

  // Socket.io connection handling
  io.on("connection", (socket) => {
    console.log(`[socket.io] Client connected: ${socket.id}`);

    socket.on("match:subscribe", ({ matchId }: { matchId: string }) => {
      socket.join(`match:${matchId}`);
      console.log(`[socket.io] ${socket.id} joined match:${matchId}`);
    });

    socket.on("match:unsubscribe", ({ matchId }: { matchId: string }) => {
      socket.leave(`match:${matchId}`);
      console.log(`[socket.io] ${socket.id} left match:${matchId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[socket.io] Client disconnected: ${socket.id}`);
    });
  });

  // Make io accessible to API routes via Express app locals
  expressApp.set("io", io);

  // Let Next.js handle all other routes
  expressApp.all("/{*path}", (req, res) => {
    return handle(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`> NETPULSE ready on http://${hostname}:${port}`);
    console.log(`> Socket.io server attached`);
  });
});
