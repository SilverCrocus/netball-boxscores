import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  markClientNavigationComplete,
  markClientNavigationStart,
} from '@/lib/client-navigation-timing';

describe('client navigation timing', () => {
  afterEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
    vi.restoreAllMocks();
  });

  it('marks a router transition safely and logs only the route path', () => {
    const nowSpy = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(147);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    markClientNavigationStart('/rankings?edition=private-edition', 'push');
    markClientNavigationComplete('/rankings?edition=private-edition');

    expect(nowSpy).toHaveBeenCalledTimes(2);
    const event = JSON.parse(String(infoSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(event).toMatchObject({
      event: 'client_navigation_timing',
      route: '/rankings',
      navigationType: 'push',
      durationMs: 47,
    });
    expect(String(infoSpy.mock.calls[0]?.[0])).not.toContain('private-edition');
  });

  it('is a no-op when there is no active transition', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    markClientNavigationComplete('/records');

    expect(infoSpy).not.toHaveBeenCalled();
  });
});
