import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';

const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 15_000;

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

const port = await availablePort();
if (!port) throw new Error('Could not allocate a localhost port');

const child = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'server.ts'],
  {
    env: {
      ...process.env,
      NODE_ENV: 'production',
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

const deadline = Date.now() + STARTUP_TIMEOUT_MS;
let healthy = false;
try {
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://${HOST}:${port}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

if (!healthy) {
  throw new Error(`Custom server failed its localhost health probe.\n${output}`);
}

console.log(`Custom server startup smoke passed on localhost:${port}`);
