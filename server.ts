import express from "express";
import { createServer } from "http";
import next from "next";
import { initSocketServer } from "./src/lib/socket-server";
import { startWorker, stopWorker } from "./src/lib/worker";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const expressApp = express();
  const httpServer = createServer(expressApp);

  // Initialize Socket.io
  const io = initSocketServer(httpServer);
  console.log("[Server] Socket.io initialized");

  // Make io accessible to API routes via Express app locals
  expressApp.set("io", io);

  // Start background worker
  startWorker();
  console.log("[Server] Background worker started");

  // Let Next.js handle all other routes
  expressApp.all("/{*path}", (req, res) => {
    return handle(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`> CentrePass ready on http://${hostname}:${port}`);
    console.log(`> Socket.io server attached`);
  });

  // Graceful shutdown (for Render deploys)
  process.on("SIGTERM", () => {
    console.log("[Server] SIGTERM received, shutting down gracefully");
    stopWorker();
    httpServer.close(() => {
      console.log("[Server] HTTP server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    console.log("[Server] SIGINT received, shutting down");
    stopWorker();
    httpServer.close(() => process.exit(0));
  });
});
