import { afterEach, describe, expect, it, vi } from 'vitest';

type WorkerHealthModule = typeof import('@/lib/worker-health');

async function loadFreshWorkerHealth(): Promise<WorkerHealthModule> {
  delete (
    globalThis as typeof globalThis & {
      __centrePassWorkerHealth?: unknown;
    }
  ).__centrePassWorkerHealth;
  vi.resetModules();
  return import('@/lib/worker-health');
}

describe('worker health', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (
      globalThis as typeof globalThis & {
        __centrePassWorkerHealth?: unknown;
      }
    ).__centrePassWorkerHealth;
  });

  it('treats a fresh failed poll as unhealthy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const { getWorkerHealth, recordPoll, setCurrentInterval } =
      await loadFreshWorkerHealth();
    setCurrentInterval(60_000);

    recordPoll('success', 1);
    expect(getWorkerHealth().isHealthy).toBe(true);

    recordPoll('error', 0);
    expect(getWorkerHealth()).toMatchObject({
      lastPollStatus: 'error',
      pollInProgress: false,
      isHealthy: false,
    });
  });

  it('stays healthy during a bounded poll that began before the previous result expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const {
      beginPoll,
      getWorkerHealth,
      recordPoll,
      setCurrentInterval,
    } = await loadFreshWorkerHealth();
    setCurrentInterval(30_000);
    recordPoll('success', 2);

    vi.advanceTimersByTime(30_000);
    beginPoll();
    vi.advanceTimersByTime(40_000);

    expect(getWorkerHealth()).toMatchObject({
      lastPollAt: '2026-07-12T00:00:00.000Z',
      lastPollStatus: 'success',
      pollInProgress: true,
      pollStartedAt: '2026-07-12T00:00:30.000Z',
      pollElapsedMs: 40_000,
      maxActivePollMs: 180_000,
      isHealthy: true,
    });
  });

  it('becomes unhealthy when an active poll reaches the deadman deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const {
      beginPoll,
      getWorkerHealth,
      recordPoll,
      setCurrentInterval,
    } = await loadFreshWorkerHealth();
    setCurrentInterval(30_000);
    recordPoll('empty', 0);
    vi.advanceTimersByTime(30_000);
    beginPoll();

    vi.advanceTimersByTime(180_000);

    expect(getWorkerHealth()).toMatchObject({
      pollInProgress: true,
      pollElapsedMs: 180_000,
      isHealthy: false,
    });
  });

  it('becomes unhealthy when the next poll timer never starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const { getWorkerHealth, recordPoll, setCurrentInterval } =
      await loadFreshWorkerHealth();
    setCurrentInterval(30_000);
    recordPoll('success', 1);

    vi.advanceTimersByTime(60_000);

    expect(getWorkerHealth()).toMatchObject({
      pollInProgress: false,
      pollStartedAt: null,
      isHealthy: false,
    });
  });

  it('does not let a late poll start restore stale readiness', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const {
      beginPoll,
      getWorkerHealth,
      recordPoll,
      setCurrentInterval,
    } = await loadFreshWorkerHealth();
    setCurrentInterval(30_000);
    recordPoll('success', 1);
    vi.advanceTimersByTime(60_000);

    beginPoll();

    expect(getWorkerHealth()).toMatchObject({
      pollInProgress: true,
      pollElapsedMs: 0,
      isHealthy: false,
    });
  });

  it('keeps startup unhealthy until the first successful poll completes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const { beginPoll, getWorkerHealth, setCurrentInterval } =
      await loadFreshWorkerHealth();
    setCurrentInterval(30_000);

    beginPoll();

    expect(getWorkerHealth()).toMatchObject({
      lastPollAt: null,
      lastPollStatus: 'pending',
      pollInProgress: true,
      isHealthy: false,
    });
  });

  it.each(['error', 'partial'])(
    'keeps a previous %s unhealthy until a successful recovery completes',
    async (failedStatus) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
      const {
        beginPoll,
        getWorkerHealth,
        recordPoll,
        setCurrentInterval,
      } = await loadFreshWorkerHealth();
      setCurrentInterval(30_000);
      recordPoll(failedStatus, 0);
      vi.advanceTimersByTime(30_000);

      beginPoll();
      expect(getWorkerHealth().isHealthy).toBe(false);

      recordPoll('success', 3);
      expect(getWorkerHealth()).toMatchObject({
        lastPollStatus: 'success',
        matchesProcessed: 3,
        pollInProgress: false,
        pollStartedAt: null,
        pollElapsedMs: null,
        isHealthy: true,
      });
    },
  );
});
