import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Prisma, PrismaClient } from '@prisma/client';

export const MEMORY_STRESS_HOST = '127.0.0.1';
export const MEMORY_PREFERRED_RSS_LIMIT_BYTES = 384 * 1024 * 1024;
export const MEMORY_HARD_RSS_LIMIT_BYTES = 410 * 1024 * 1024;
export const MIN_REPRESENTATIVE_MATCHES = 38;
export const MIN_REPRESENTATIVE_PLAYERS = 12;
export const MIN_REPRESENTATIVE_TEAMS = 12;

const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 7_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_WAVES = 3;
const DEFAULT_EPOCH_ROTATIONS = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MEMORY_SAMPLE_INTERVAL_MS = 250;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DATABASE_URL_NAMES = [
  'DATABASE_URL',
  'DIRECT_URL',
  'ANALYTICS_DATABASE_URL',
  'STATS_OPERATIONS_DATABASE_URL',
] as const;

export interface MemoryStressOptions {
  concurrency: number;
  waves: number;
  epochRotations: number;
  requestTimeoutMs: number;
  representativeDataConfirmed: boolean;
}

export interface MemoryStressRoute {
  name: 'rankings' | 'records' | 'live' | 'standings';
  path: string;
}

export interface MemoryStressMemorySample {
  childRssBytes: number | null;
  childHeapUsedBytes: number | null;
  harnessRssBytes: number;
  harnessHeapUsedBytes: number;
}

export interface RepresentativeCounts {
  matches: number;
  players: number;
  teams: number;
}

export interface MemoryStressSummary {
  representativeCounts: RepresentativeCounts;
  waves: number;
  concurrency: number;
  epochRotations: number;
  requestFailures: number;
  healthFailures: number;
  readinessFailures: number;
  unhandledRejectionObserved: boolean;
  samples: number;
  peakChildRssBytes: number | null;
  peakChildHeapUsedBytes: number | null;
  peakHarnessRssBytes: number;
  peakHarnessHeapUsedBytes: number;
  preferredRssTargetPassed: boolean;
  hardRssLimitPassed: boolean;
}

export class LocalMemoryStressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalMemoryStressBlockedError';
  }
}

function boundedInteger(value: string, name: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

export function parseMemoryStressOptions(argv: readonly string[]): MemoryStressOptions {
  const options: MemoryStressOptions = {
    concurrency: DEFAULT_CONCURRENCY,
    waves: DEFAULT_WAVES,
    epochRotations: DEFAULT_EPOCH_ROTATIONS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    representativeDataConfirmed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--representative-data-confirmed') {
      options.representativeDataConfirmed = true;
      continue;
    }
    const [name, value] = argument.split('=', 2);
    if (!value) throw new Error(`Unknown or incomplete memory stress argument: ${argument}`);
    if (name === '--concurrency') options.concurrency = boundedInteger(value, 'concurrency', 1, 16);
    else if (name === '--waves') options.waves = boundedInteger(value, 'waves', 1, 12);
    else if (name === '--epoch-rotations') options.epochRotations = boundedInteger(value, 'epoch rotations', 0, 11);
    else if (name === '--request-timeout-ms') options.requestTimeoutMs = boundedInteger(value, 'request timeout', 1_000, 60_000);
    else throw new Error(`Unknown memory stress argument: ${argument}`);
  }

  if (options.epochRotations > options.waves - 1) {
    throw new Error('epoch rotations cannot exceed waves minus one');
  }
  return options;
}

function isLoopbackUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertLocalMemoryStressEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.DATABASE_ENVIRONMENT !== 'local') {
    throw new LocalMemoryStressBlockedError('Phase 2 memory stress requires DATABASE_ENVIRONMENT=local');
  }
  if (env.WORKER_ENABLED !== 'false') {
    throw new LocalMemoryStressBlockedError('Phase 2 memory stress requires WORKER_ENABLED=false');
  }
  for (const name of DATABASE_URL_NAMES) {
    const value = env[name];
    if (value && !isLoopbackUrl(value)) {
      throw new LocalMemoryStressBlockedError(`${name} must target loopback PostgreSQL only`);
    }
  }
  if (!isLoopbackUrl(env.DATABASE_URL) || !isLoopbackUrl(env.DIRECT_URL) || !isLoopbackUrl(env.ANALYTICS_DATABASE_URL)) {
    throw new LocalMemoryStressBlockedError(
      'Phase 2 memory stress requires loopback DATABASE_URL, DIRECT_URL, and ANALYTICS_DATABASE_URL',
    );
  }
  if (env.SUPABASE_PROJECT_REF || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_URL) {
    throw new LocalMemoryStressBlockedError('Phase 2 memory stress refuses hosted Supabase or Render targets');
  }
}

export function buildMemoryStressRoutes(): readonly MemoryStressRoute[] {
  return [
    {
      name: 'rankings',
      path: '/rankings?metric=goals&aggregation=TOTAL&minimumMinutes=120&lastN=5',
    },
    {
      name: 'records',
      path: '/records?scope=EDITION&metric=goals&entity=PLAYER&aggregation=TOTAL',
    },
    { name: 'live', path: '/live' },
    { name: 'standings', path: '/standings' },
  ];
}

export function buildMemoryStressWave(concurrency: number): readonly MemoryStressRoute[] {
  return buildMemoryStressRoutes().flatMap((route) => Array.from({ length: concurrency }, () => route));
}

function readChildRssBytes(pid: number): number | null {
  try {
    const output = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const kilobytes = Number(output);
    return Number.isFinite(kilobytes) && kilobytes >= 0 ? kilobytes * 1024 : null;
  } catch {
    return null;
  }
}

function sampleProcessMemory(child: ChildProcess, samples: MemoryStressMemorySample[]): void {
  const harness = process.memoryUsage();
  const childRssBytes = child.pid ? readChildRssBytes(child.pid) : null;
  samples.push({
    childRssBytes,
    childHeapUsedBytes: null,
    harnessRssBytes: harness.rss,
    harnessHeapUsedBytes: harness.heapUsed,
  });
}

function applyChildMemorySample(
  message: unknown,
  samples: MemoryStressMemorySample[],
): void {
  if (!message || typeof message !== 'object') return;
  const candidate = message as Record<string, unknown>;
  if (candidate.type !== 'phase2-memory-sample') return;
  const memory = candidate.memory;
  if (!memory || typeof memory !== 'object') return;
  const values = memory as Record<string, unknown>;
  const childRssBytes = typeof values.rss === 'number' ? values.rss : null;
  const childHeapUsedBytes = typeof values.heapUsed === 'number' ? values.heapUsed : null;
  const harness = process.memoryUsage();
  samples.push({
    childRssBytes,
    childHeapUsedBytes,
    harnessRssBytes: harness.rss,
    harnessHeapUsedBytes: harness.heapUsed,
  });
}

function peak(samples: readonly MemoryStressMemorySample[], field: keyof MemoryStressMemorySample): number | null {
  const values = samples
    .map((sample) => sample[field])
    .filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? Math.max(...values) : null;
}

export function summarizeMemorySamples(
  samples: readonly MemoryStressMemorySample[],
  representativeCounts: RepresentativeCounts,
  options: MemoryStressOptions,
  requestFailures: number,
  healthFailures: number,
  readinessFailures: number,
  unhandledRejectionObserved: boolean,
): MemoryStressSummary {
  const peakChildRssBytes = peak(samples, 'childRssBytes');
  const peakChildHeapUsedBytes = peak(samples, 'childHeapUsedBytes');
  const peakHarnessRssBytes = peak(samples, 'harnessRssBytes') ?? 0;
  const peakHarnessHeapUsedBytes = peak(samples, 'harnessHeapUsedBytes') ?? 0;
  return {
    representativeCounts,
    waves: options.waves,
    concurrency: options.concurrency,
    epochRotations: options.epochRotations,
    requestFailures,
    healthFailures,
    readinessFailures,
    unhandledRejectionObserved,
    samples: samples.length,
    peakChildRssBytes,
    peakChildHeapUsedBytes,
    peakHarnessRssBytes,
    peakHarnessHeapUsedBytes,
    preferredRssTargetPassed: peakChildRssBytes !== null
      && peakChildRssBytes < MEMORY_PREFERRED_RSS_LIMIT_BYTES,
    hardRssLimitPassed: peakChildRssBytes !== null
      && peakChildRssBytes < MEMORY_HARD_RSS_LIMIT_BYTES,
  };
}

async function availablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, MEMORY_STRESS_HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => error ? reject(error) : port ? resolvePort(port) : reject(new Error('No local port allocated')));
    });
  });
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error('Memory stress server did not exit during shutdown')), SHUTDOWN_TIMEOUT_MS);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

async function waitForStatus(
  child: ChildProcess,
  port: number,
  path: string,
  expectedStatus: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`http://${MEMORY_STRESS_HOST}:${port}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel();
      if (response.status === expectedStatus) return true;
    } catch {
      // The production server is still starting or the local request timed out.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

async function probeStatus(
  port: number,
  path: string,
  expectedStatus: number,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetch(`http://${MEMORY_STRESS_HOST}:${port}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return response.status === expectedStatus;
  } catch {
    return false;
  }
}

async function requestRoute(
  port: number,
  route: MemoryStressRoute,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetch(`http://${MEMORY_STRESS_HOST}:${port}${route.path}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

async function readRepresentativeCounts(prisma: PrismaClient): Promise<RepresentativeCounts> {
  try {
    const [counts] = await prisma.$queryRaw<Array<{ matches: bigint; players: bigint; teams: bigint }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "Match") AS matches,
        (SELECT COUNT(*) FROM "Player") AS players,
        (SELECT COUNT(*) FROM "Team") AS teams
    `);
    return {
      matches: Number(counts?.matches ?? BigInt(0)),
      players: Number(counts?.players ?? BigInt(0)),
      teams: Number(counts?.teams ?? BigInt(0)),
    };
  } catch {
    throw new LocalMemoryStressBlockedError(
      'Representative local PostgreSQL data could not be inspected; the 512 MiB headroom gate was not evaluated',
    );
  }
}

function assertRepresentativeCounts(counts: RepresentativeCounts): void {
  if (counts.matches < MIN_REPRESENTATIVE_MATCHES
    || counts.players < MIN_REPRESENTATIVE_PLAYERS
    || counts.teams < MIN_REPRESENTATIVE_TEAMS) {
    throw new LocalMemoryStressBlockedError(
      'Local PostgreSQL is reachable but does not contain the required representative fixture scale; the 512 MiB headroom gate was not evaluated',
    );
  }
}

async function rotateEpoch(prisma: PrismaClient): Promise<void> {
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT analytics.advance_cache_epoch()`);
  } catch {
    throw new LocalMemoryStressBlockedError(
      'The local analytics cache epoch function is unavailable; the 512 MiB headroom gate was not evaluated',
    );
  }
}

function childEnvironment(env: NodeJS.ProcessEnv, port: number): NodeJS.ProcessEnv {
  return {
    ...env,
    NODE_ENV: 'production',
    HOSTNAME: MEMORY_STRESS_HOST,
    PORT: String(port),
    DATABASE_ENVIRONMENT: 'local',
    NEXTAUTH_URL: `http://${MEMORY_STRESS_HOST}:${port}`,
    NEXTAUTH_SECRET: 'local-memory-stress-secret-for-tests-only-123456',
    WORKER_ENABLED: 'false',
    SIMULATION_MODE: 'false',
    ANALYTICS_FEATURES_ENABLED: 'true',
    ANALYTICS_DATABASE_URL: env.ANALYTICS_DATABASE_URL,
    ASK_CENTREPASS_ENABLED: 'false',
    DRAFT_PREVIEW_ENABLED: 'false',
    LOCAL_MEMORY_STRESS: 'true',
  };
}

async function runStress(options: MemoryStressOptions): Promise<MemoryStressSummary> {
  assertLocalMemoryStressEnvironment();
  if (!options.representativeDataConfirmed) {
    throw new LocalMemoryStressBlockedError(
      'Pass --representative-data-confirmed only after selecting the approved local representative fixture; no headroom claim was made',
    );
  }
  if (!existsSync(resolve(process.cwd(), '.next', 'BUILD_ID'))) {
    throw new LocalMemoryStressBlockedError(
      'A production build is required before the memory stress harness; no headroom claim was made',
    );
  }

  const directUrl = process.env.DIRECT_URL!;
  const prisma = new PrismaClient({ datasourceUrl: directUrl });
  let child: ChildProcess | undefined;
  const samples: MemoryStressMemorySample[] = [];
  let requestFailures = 0;
  let healthFailures = 0;
  let readinessFailures = 0;
  let unhandledRejectionObserved = false;
  let monitorRunning = true;
  let monitor: Promise<void> | undefined;

  try {
    try {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    } catch {
      throw new LocalMemoryStressBlockedError(
        'Representative local PostgreSQL is unavailable at the loopback target; the 512 MiB headroom gate was not evaluated',
      );
    }
    const representativeCounts = await readRepresentativeCounts(prisma);
    assertRepresentativeCounts(representativeCounts);
    const port = await availablePort();
    child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'server.ts'],
      { env: childEnvironment(process.env, port), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    child.on('message', (message) => applyChildMemorySample(message, samples));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (/UnhandledPromiseRejection|unhandledRejection/u.test(chunk)) unhandledRejectionObserved = true;
    });
    child.on('error', () => { requestFailures += 1; });

    const healthy = await waitForStatus(child, port, '/api/health', 200, options.requestTimeoutMs);
    const ready = await waitForStatus(child, port, '/api/readiness', 200, options.requestTimeoutMs);
    if (!healthy) healthFailures += 1;
    if (!ready) readinessFailures += 1;
    if (!healthy || !ready) throw new Error('Local production server did not become healthy and ready');

    monitor = (async () => {
      while (monitorRunning && child?.exitCode === null) {
        const [healthOk, readinessOk] = await Promise.all([
          probeStatus(port, '/api/health', 200, options.requestTimeoutMs),
          probeStatus(port, '/api/readiness', 200, options.requestTimeoutMs),
        ]);
        if (!healthOk) healthFailures += 1;
        if (!readinessOk) readinessFailures += 1;
        sampleProcessMemory(child, samples);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, MEMORY_SAMPLE_INTERVAL_MS));
      }
    })();

    for (let wave = 0; wave < options.waves; wave += 1) {
      const results = await Promise.all(buildMemoryStressWave(options.concurrency).map((route) => requestRoute(
        port,
        route,
        options.requestTimeoutMs,
      )));
      requestFailures += results.filter((result) => !result).length;
      if (wave < options.epochRotations) await rotateEpoch(prisma);
    }

    monitorRunning = false;
    await monitor;
    sampleProcessMemory(child, samples);
    child.kill('SIGTERM');
    const exitResult = await waitForExit(child);
    if (exitResult.code !== 0 || exitResult.signal !== null || unhandledRejectionObserved) {
      throw new Error('Local production server exited unexpectedly or reported an unhandled rejection');
    }
    const summary = summarizeMemorySamples(
      samples,
      representativeCounts,
      options,
      requestFailures,
      healthFailures,
      readinessFailures,
      unhandledRejectionObserved,
    );
    if (summary.requestFailures > 0 || summary.healthFailures > 0 || summary.readinessFailures > 0 || !summary.hardRssLimitPassed) {
      throw new Error('Phase 2 memory stress did not satisfy request, health, readiness, or RSS limits');
    }
    return summary;
  } finally {
    monitorRunning = false;
    await monitor?.catch(() => undefined);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await waitForExit(child).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  try {
    const options = parseMemoryStressOptions(process.argv.slice(2));
    const summary = await runStress(options);
    console.log(JSON.stringify({ type: 'phase2-memory-stress', ...summary }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown memory stress failure';
    if (error instanceof LocalMemoryStressBlockedError) {
      console.error(`Phase 2 memory stress blocked: ${message}`);
      process.exitCode = 2;
      return;
    }
    console.error(`Phase 2 memory stress failed: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('scripts/stress-phase2-memory.ts')) {
  void main();
}
