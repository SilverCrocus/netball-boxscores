import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { io as createSocketClient } from 'socket.io-client';

const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 20_000;
const SHUTDOWN_TIMEOUT_MS = 7_000;

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(child, port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://${HOST}:${port}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Custom server did not become healthy before the startup deadline');
}

async function connectSocket(port) {
  const socket = createSocketClient(`http://${HOST}:${port}`, {
    path: '/api/socketio',
    transports: ['websocket'],
    reconnection: false,
    timeout: 3_000,
    forceNew: true,
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Custom server did not exit within ${SHUTDOWN_TIMEOUT_MS}ms`));
    }, SHUTDOWN_TIMEOUT_MS);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

function waitForSocketDisconnect(socket) {
  if (!socket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Socket.IO client did not disconnect during shutdown'));
    }, SHUTDOWN_TIMEOUT_MS);
    socket.once('disconnect', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function runLauncherSmoke({ mode, signal, requireSocket }) {
  const port = await availablePort();
  if (!port) throw new Error('Could not allocate a localhost port');
  const child = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'server.ts'],
    {
      env: {
        ...process.env,
        NODE_ENV: mode,
        HOSTNAME: HOST,
        PORT: String(port),
        DATABASE_URL: 'postgresql://ci:ci@127.0.0.1:5432/centrepass',
        DIRECT_URL: 'postgresql://ci:ci@127.0.0.1:5432/centrepass',
        DATABASE_ENVIRONMENT: 'local',
        NEXTAUTH_URL: `http://${HOST}:${port}`,
        NEXTAUTH_SECRET: 'server-startup-smoke-secret-more-than-32-characters',
        WORKER_ENABLED: 'false',
        SIMULATION_MODE: 'false',
        ANALYTICS_FEATURES_ENABLED: 'false',
        ASK_CENTREPASS_ENABLED: 'false',
        DRAFT_PREVIEW_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-16_000);
    });
  }

  let socket;
  try {
    await waitForHealth(child, port);
    if (requireSocket) socket = await connectSocket(port);
    const disconnected = waitForSocketDisconnect(socket);
    const shutdownStartedAt = Date.now();
    if (!child.kill(signal)) throw new Error(`Could not deliver ${signal} to custom server`);
    const result = await waitForExit(child);
    await disconnected;
    if (result.code !== 0 || result.signal !== null) {
      throw new Error(`Custom server exited with code=${result.code} signal=${result.signal}`);
    }
    console.log(
      `${mode} custom server ${requireSocket ? 'active-socket ' : ''}shutdown smoke passed `
      + `on localhost:${port} in ${Date.now() - shutdownStartedAt}ms`,
    );
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`);
  } finally {
    socket?.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child).catch(() => undefined);
    }
  }
}

await runLauncherSmoke({ mode: 'production', signal: 'SIGTERM', requireSocket: true });
await runLauncherSmoke({ mode: 'development', signal: 'SIGINT', requireSocket: true });
