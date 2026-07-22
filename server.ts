import express from "express";
import { createServer } from "http";
import next from "next";
import { getWorkerStartupDecision } from "./src/lib/worker-startup";
import { getSimulationDatabaseSafetyDecision } from "./src/lib/simulation/safety";
import { assertRuntimeEnvironment } from "./src/lib/runtime-environment";
import { safeErrorMessage } from "./src/lib/safe-logging";

const SHUTDOWN_TIMEOUT_MS = 5_000;

const localMemoryStressInterval = process.env.LOCAL_MEMORY_STRESS === 'true'
  && process.env.DATABASE_ENVIRONMENT === 'local'
  && typeof process.send === 'function'
  ? setInterval(() => {
    process.send?.({ type: 'phase2-memory-sample', memory: process.memoryUsage() });
  }, 250)
  : null;
localMemoryStressInterval?.unref();

const SIM_MODE = process.env.SIMULATION_MODE === 'true';
const dev = process.env.NODE_ENV !== "production";
const hostname = dev ? "localhost" : (process.env.HOSTNAME || "0.0.0.0");
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  assertRuntimeEnvironment();
  // Socket and worker modules reach Next server-only runtime primitives through
  // their public-access dependencies. Loading them before app.prepare() makes
  // Next's AsyncLocalStorage unavailable under the standalone TSX launcher.
  const [{ initSocketServer }, { startWorker, stopWorker }] = await Promise.all([
    import('./src/lib/socket-server'),
    import('./src/lib/worker'),
  ]);

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
  expressApp.disable('x-powered-by');
  const httpServer = createServer(expressApp);

  // Initialize Socket.io
  const io = initSocketServer(httpServer);
  console.log("[Server] Socket.io initialized");

  let shutdownStarted = false;
  const shutdown = (reason: string, requestedExitCode = 0): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    let exitCode = requestedExitCode;
    let pendingClosures = 2;
    let finished = false;

    console.log(`[Server] ${reason} received, shutting down gracefully`);
    if (workerStartup.shouldStart) stopWorker();

    const deadline = setTimeout(() => {
      if (finished) return;
      finished = true;
      console.error(`[Server] Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    const closed = (component: string, error?: Error | null) => {
      if (finished) return;
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        exitCode = 1;
        console.error(`[Server] ${component} close failed:`, safeErrorMessage(error));
      }
      pendingClosures -= 1;
      if (pendingClosures > 0) return;
      finished = true;
      clearTimeout(deadline);
      console.log('[Server] Socket.IO clients and HTTP server closed');
      process.exit(exitCode);
    };

    // Stop accepting new HTTP work first, then explicitly disconnect upgraded
    // Socket.IO clients so the HTTP close callback cannot wait indefinitely.
    httpServer.close((error) => closed('HTTP server', error));
    httpServer.closeIdleConnections?.();
    io.disconnectSockets(true);
    io.close(() => closed('Socket.IO'));
  };

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
        console.error('[Server] Required background worker failed:', safeErrorMessage(error));
        shutdown('required background worker failure', 1);
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

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}).catch((error) => {
  console.error('[Server] Failed to start:', safeErrorMessage(error));
  process.exit(1);
});
