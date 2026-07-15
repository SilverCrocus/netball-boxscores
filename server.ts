import express from "express";
import { createServer } from "http";
import next from "next";
import { initSocketServer } from "./src/lib/socket-server";
import { startWorker, stopWorker } from "./src/lib/worker";
import { getWorkerStartupDecision } from "./src/lib/worker-startup";
import { getSimulationDatabaseSafetyDecision } from "./src/lib/simulation/safety";

const SIM_MODE = process.env.SIMULATION_MODE === 'true';
const dev = process.env.NODE_ENV !== "production";
const hostname = dev ? "localhost" : (process.env.HOSTNAME || "0.0.0.0");
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const workerStartup = getWorkerStartupDecision();
  if (workerStartup.state === 'blocked') {
    throw new Error(`[Server] Worker startup blocked: ${workerStartup.reason}`);
  }

  if (SIM_MODE && workerStartup.shouldStart) {
    const simulationSafety = getSimulationDatabaseSafetyDecision();
    if (!simulationSafety.allowed) {
      throw new Error(`[Server] Simulation startup blocked: ${simulationSafety.reason}`);
    }
  }

  const expressApp = express();
  const httpServer = createServer(expressApp);

  // Initialize Socket.io
  const io = initSocketServer(httpServer);
  console.log("[Server] Socket.io initialized");

  // Make io accessible to API routes via Express app locals
  expressApp.set("io", io);

  // Mount simulation routes — dev only, never in production
  if (SIM_MODE && workerStartup.shouldStart) {
    const { simRouter } = await import('./src/lib/simulation/sim-routes');
    const { cleanupOrphanedSimData } = await import('./src/lib/simulation/engine');
    expressApp.use('/api/sim', simRouter);
    console.log('[Server] Simulation routes mounted at /api/sim');

    // Clean up any orphaned sim data from previous crashes
    const cleaned = await cleanupOrphanedSimData();
    if (cleaned > 0) {
      console.log(`[Server] Cleaned up ${cleaned} orphaned simulation match(es)`);
    }
  } else if (SIM_MODE) {
    console.warn('[Server] SIMULATION_MODE is set but ignored because WORKER_ENABLED is not true');
  }

  // Start background polling only when explicitly configured.
  if (workerStartup.shouldStart) {
    console.log("[Server] Background worker starting");
    void startWorker()
      .then(() => {
        console.log("[Server] Background worker started");
      })
      .catch((error) => {
        console.error('[Server] Required background worker failed:', error);
        stopWorker();
        httpServer.close();
        process.exit(1);
      });
  } else {
    console.log(`[Server] Background worker disabled: ${workerStartup.reason}`);
  }

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
    if (workerStartup.shouldStart) stopWorker();
    httpServer.close(() => {
      console.log("[Server] HTTP server closed");
      process.exit(0);
    });
  });

  process.on("SIGINT", () => {
    console.log("[Server] SIGINT received, shutting down");
    if (workerStartup.shouldStart) stopWorker();
    httpServer.close(() => process.exit(0));
  });
}).catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});
