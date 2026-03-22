import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/match-sync', () => ({
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
}));

describe('Worker', () => {
  it('should export getPollingInterval function', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(typeof getPollingInterval).toBe('function');
  });

  it('should return 30s for live matches', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true)).toBe(30_000);
  });

  it('should return 15min for match day with no live match', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, true)).toBe(900_000);
  });

  it('should return 6h for off-season', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false)).toBe(21_600_000);
  });
});
