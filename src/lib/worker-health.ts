const startedAt = Date.now();

let lastPollAt: Date | null = null;
let lastPollStatus: string = 'pending';
let currentIntervalMs: number = 0;
let matchesProcessed: number = 0;
let pollsSinceStartup: number = 0;

export function recordPoll(status: string, matchCount: number): void {
  lastPollAt = new Date();
  lastPollStatus = status;
  matchesProcessed = matchCount;
  pollsSinceStartup++;
}

export function setCurrentInterval(ms: number): void {
  currentIntervalMs = ms;
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
  const uptimeMs = Date.now() - startedAt;
  const isHealthy =
    lastPollAt !== null &&
    Date.now() - lastPollAt.getTime() < currentIntervalMs * 2;

  return {
    lastPollAt: lastPollAt?.toISOString() ?? null,
    lastPollStatus,
    currentIntervalMs,
    matchesProcessed,
    pollsSinceStartup,
    uptimeMs,
    isHealthy,
  };
}
