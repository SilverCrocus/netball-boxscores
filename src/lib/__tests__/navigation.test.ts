import { describe, expect, it } from 'vitest';
import {
  getNavigationPrefetchPolicy,
  getVisibleNavigationItems,
  isResolvedNavigationActive,
} from '@/lib/navigation';

describe('isResolvedNavigationActive', () => {
  const editionBase = '/competitions/commonwealth-games-netball/glasgow-2026';

  it('marks an edition home link active only on the edition landing', () => {
    expect(isResolvedNavigationActive(editionBase, '/', editionBase)).toBe(true);
    expect(isResolvedNavigationActive(`${editionBase}/pools`, '/', editionBase)).toBe(false);
  });

  it('keeps resolved section links active on their nested routes', () => {
    const standings = `${editionBase}/standings`;
    expect(isResolvedNavigationActive(standings, '/standings', standings)).toBe(true);
    expect(isResolvedNavigationActive(`${standings}/form`, '/standings', standings)).toBe(true);
  });

  it('retains active state for legacy routes', () => {
    expect(isResolvedNavigationActive('/teams', '/teams', `${editionBase}/teams`)).toBe(true);
  });

  it('removes analytics and Ask destinations independently when their server switches are off', () => {
    expect(getVisibleNavigationItems({ analyticsEnabled: false, askCentrePassEnabled: false }).map((item) => item.href)).toEqual([
      '/', '/live', '/standings', '/teams',
    ]);
    expect(getVisibleNavigationItems({ analyticsEnabled: true, askCentrePassEnabled: false }).map((item) => item.href)).toContain('/rankings');
    expect(getVisibleNavigationItems({ analyticsEnabled: true, askCentrePassEnabled: false }).map((item) => item.href)).not.toContain('/explore');
  });

  it('keeps prefetch policies on exact allowlists', () => {
    expect(getNavigationPrefetchPolicy('/rankings')).toBe('intent-full');
    expect(getNavigationPrefetchPolicy('/records')).toBe('intent-full');
    expect(getNavigationPrefetchPolicy('/teams')).toBe('off');
    expect(getNavigationPrefetchPolicy('/compare/players')).toBe('off');
    expect(getNavigationPrefetchPolicy('/explore')).toBe('off');
  });

  it('leaves protected default-prefetch destinations outside the off policy', () => {
    expect(getNavigationPrefetchPolicy('/')).toBeUndefined();
    expect(getNavigationPrefetchPolicy('/live')).toBeUndefined();
    expect(getNavigationPrefetchPolicy('/standings')).toBeUndefined();
    expect(getNavigationPrefetchPolicy('/competitions/commonwealth-games-netball/glasgow-2026/standings')).toBeUndefined();
    expect(getNavigationPrefetchPolicy('/rankings?view=players')).toBeUndefined();
    expect(getNavigationPrefetchPolicy('/rankings?view=teams')).toBeUndefined();
  });
});
