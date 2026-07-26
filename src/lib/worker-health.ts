interface WorkerHealthStore {
  startedAt: number;
  lastPollAt: Date | null;
  pollStartedAt: Date | null;
  lastPollStatus: string;
  currentIntervalMs: number;
  matchesProcessed: number;
  pollsSinceStartup: number;
}

export const MAX_ACTIVE_POLL_MS = 180_000;

// The custom server and Next route handlers can load separate bundled copies of
// this module. Store health on the shared Node global so both copies observe the
// same worker state in production.
const globalForWorkerHealth = globalThis as typeof globalThis & {
  __centrePassWorkerHealth?: WorkerHealthStore;
};

const workerHealth = globalForWorkerHealth.__centrePassWorkerHealth ?? {
  startedAt: Date.now(),
  lastPollAt: null,
  pollStartedAt: null,
  lastPollStatus: 'pending',
  currentIntervalMs: 0,
  matchesProcessed: 0,
  pollsSinceStartup: 0,
};

globalForWorkerHealth.__centrePassWorkerHealth = workerHealth;

export function beginPoll(): void {
  // Keep the original start time if an unexpected overlapping caller appears,
  // so duplicate starts cannot extend the deadman deadline.
  workerHealth.pollStartedAt ??= new Date();
}

export function recordPoll(status: string, matchCount: number): void {
  workerHealth.lastPollAt = new Date();
  workerHealth.pollStartedAt = null;
  workerHealth.lastPollStatus = status;
  workerHealth.matchesProcessed = matchCount;
  workerHealth.pollsSinceStartup++;
}

export function setCurrentInterval(ms: number): void {
  workerHealth.currentIntervalMs = ms;
}

export interface WorkerHealthStatus {
  lastPollAt: string | null;
  lastPollStatus: string;
  currentIntervalMs: number;
  matchesProcessed: number;
  pollsSinceStartup: number;
  uptimeMs: number;
  pollInProgress: boolean;
  pollStartedAt: string | null;
  pollElapsedMs: number | null;
  maxActivePollMs: number;
  isHealthy: boolean;
}

export function getWorkerHealth(): WorkerHealthStatus {
  const now = Date.now();
  const uptimeMs = now - workerHealth.startedAt;
  const pollStartedAt = workerHealth.pollStartedAt ?? null;
  const pollElapsedMs = pollStartedAt === null
    ? null
    : now - pollStartedAt.getTime();
  const completionAgeMs = workerHealth.lastPollAt === null
    ? null
    : now - workerHealth.lastPollAt.getTime();
  const completionFreshnessMs = workerHealth.currentIntervalMs * 2;
  const goodPreviousResult =
    workerHealth.lastPollAt !== null &&
    workerHealth.currentIntervalMs > 0 &&
    (workerHealth.lastPollStatus === 'success' || workerHealth.lastPollStatus === 'empty') &&
    completionAgeMs !== null &&
    completionAgeMs >= 0;
  const idleHealthy =
    pollStartedAt === null &&
    completionAgeMs !== null &&
    completionAgeMs < completionFreshnessMs;
  const activeHealthy =
    pollStartedAt !== null &&
    workerHealth.lastPollAt !== null &&
    pollElapsedMs !== null &&
    pollElapsedMs >= 0 &&
    pollElapsedMs < MAX_ACTIVE_POLL_MS &&
    pollStartedAt.getTime() >= workerHealth.lastPollAt.getTime() &&
    pollStartedAt.getTime()
      < workerHealth.lastPollAt.getTime() + completionFreshnessMs;
  const isHealthy = goodPreviousResult && (idleHealthy || activeHealthy);

  return {
    lastPollAt: workerHealth.lastPollAt?.toISOString() ?? null,
    lastPollStatus: workerHealth.lastPollStatus,
    currentIntervalMs: workerHealth.currentIntervalMs,
    matchesProcessed: workerHealth.matchesProcessed,
    pollsSinceStartup: workerHealth.pollsSinceStartup,
    uptimeMs,
    pollInProgress: pollStartedAt !== null,
    pollStartedAt: pollStartedAt?.toISOString() ?? null,
    pollElapsedMs,
    maxActivePollMs: MAX_ACTIVE_POLL_MS,
    isHealthy,
  };
}
