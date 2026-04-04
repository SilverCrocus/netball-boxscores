import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/match-sync', () => ({
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
}));

describe('Worker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should export getPollingInterval function', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(typeof getPollingInterval).toBe('function');
  });

  it('should return 30s for live matches', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true, false)).toBe(30_000);
  });

  it('should return 1min for pre-match', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false, true)).toBe(60_000);
  });

  it('should return 15min for match day with no live match', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, true, false)).toBe(900_000);
  });

  it('should return 6h for off-season', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false, false)).toBe(21_600_000);
  });

  it('should return 2s when SIMULATION_MODE is true', async () => {
    vi.stubEnv('SIMULATION_MODE', 'true');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true, false)).toBe(2_000);
  });
});
