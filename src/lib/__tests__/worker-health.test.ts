import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWorkerHealth, recordPoll, setCurrentInterval } from '@/lib/worker-health';

describe('worker health', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a fresh failed poll as unhealthy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    setCurrentInterval(60_000);

    recordPoll('success', 1);
    expect(getWorkerHealth().isHealthy).toBe(true);

    recordPoll('error', 0);
    expect(getWorkerHealth()).toMatchObject({
      lastPollStatus: 'error',
      isHealthy: false,
    });
  });
});
