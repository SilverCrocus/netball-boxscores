interface WorkerHealthStore {
  startedAt: number;
  lastPollAt: Date | null;
  lastPollStatus: string;
  currentIntervalMs: number;
  matchesProcessed: number;
  pollsSinceStartup: number;
}

// The custom server and Next route handlers can load separate bundled copies of
// this module. Store health on the shared Node global so both copies observe the
// same worker state in production.
const globalForWorkerHealth = globalThis as typeof globalThis & {
  __centrePassWorkerHealth?: WorkerHealthStore;
};

const workerHealth = globalForWorkerHealth.__centrePassWorkerHealth ?? {
  startedAt: Date.now(),
  lastPollAt: null,
  lastPollStatus: 'pending',
  currentIntervalMs: 0,
  matchesProcessed: 0,
  pollsSinceStartup: 0,
};

globalForWorkerHealth.__centrePassWorkerHealth = workerHealth;

export function recordPoll(status: string, matchCount: number): void {
  workerHealth.lastPollAt = new Date();
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
  isHealthy: boolean;
}

export function getWorkerHealth(): WorkerHealthStatus {
  const uptimeMs = Date.now() - workerHealth.startedAt;
  const isHealthy =
    workerHealth.lastPollAt !== null &&
    workerHealth.currentIntervalMs > 0 &&
    (workerHealth.lastPollStatus === 'success' || workerHealth.lastPollStatus === 'empty') &&
    Date.now() - workerHealth.lastPollAt.getTime() < workerHealth.currentIntervalMs * 2;

  return {
    lastPollAt: workerHealth.lastPollAt?.toISOString() ?? null,
    lastPollStatus: workerHealth.lastPollStatus,
    currentIntervalMs: workerHealth.currentIntervalMs,
    matchesProcessed: workerHealth.matchesProcessed,
    pollsSinceStartup: workerHealth.pollsSinceStartup,
    uptimeMs,
    isHealthy,
  };
}
