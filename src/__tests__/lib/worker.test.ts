import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {},
  excludeSimData: {},
}));

vi.mock('@/lib/live-state', () => ({
  getLiveState: vi.fn(),
}));

vi.mock('@/lib/ingestion', () => ({
  ingestFromChampionData: vi.fn(),
}));

vi.mock('@/lib/processing', () => ({
  validateMatchData: vi.fn(),
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
  reconcileCompletedMatches: vi.fn(),
  detectStaleCompletedMatches: vi.fn(),
}));

vi.mock('@/lib/broadcasting', () => ({
  broadcastMatchChanges: vi.fn(),
  broadcastPlayerStats: vi.fn(),
  broadcastInterceptEvents: vi.fn(),
  broadcastCompletion: vi.fn(),
}));

vi.mock('@/lib/standings', () => ({
  recalculateStandings: vi.fn(),
}));

vi.mock('@/lib/worker-health', () => ({
  recordPoll: vi.fn(),
  setCurrentInterval: vi.fn(),
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

  it('should return 2min for match day with no live match', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, true, false)).toBe(120_000);
  });

  it('should return 1h for off-season', async () => {
    vi.stubEnv('SIMULATION_MODE', '');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false, false)).toBe(3_600_000);
  });

  it('should return 2s when SIMULATION_MODE is true', async () => {
    vi.stubEnv('SIMULATION_MODE', 'true');
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true, false)).toBe(2_000);
  });
});
