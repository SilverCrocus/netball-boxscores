import { describe, expect, it } from 'vitest';
import type { EditionContextValue } from '@/lib/edition-context';
import {
  editionHref,
  editionNavigationHref,
  editionSwitchHref,
} from '@/lib/edition-links';

const ssn: EditionContextValue = {
  id: 'ssn-2026',
  competitionSlug: 'suncorp-super-netball',
  competitionName: 'Suncorp Super Netball',
  editionSlug: '2026',
  editionLabel: '2026',
  sourceTimezone: 'Australia/Sydney',
};

const glasgow: EditionContextValue = {
  id: 'glasgow-2026',
  competitionSlug: 'commonwealth-games',
  competitionName: 'Commonwealth Games',
  editionSlug: 'glasgow-2026',
  editionLabel: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
};

describe('edition links', () => {
  it('builds canonical links for edition destinations', () => {
    expect(editionHref(ssn, 'standings')).toBe(
      '/competitions/suncorp-super-netball/2026/standings'
    );
  });

  it.each(['desktop', 'mobile'] as const)(
    'preserves edition context in %s navigation',
    () => {
      expect(editionNavigationHref(glasgow, 'teams')).toBe(
        '/competitions/commonwealth-games/glasgow-2026/teams'
      );
    }
  );

  it('preserves the current section when switching editions', () => {
    expect(editionSwitchHref(
      glasgow,
      '/competitions/suncorp-super-netball/2026/standings'
    )).toBe('/competitions/commonwealth-games/glasgow-2026/standings');
  });

  it('falls back to the edition landing path for unrelated routes', () => {
    expect(editionSwitchHref(glasgow, '/match/abc')).toBe(
      '/competitions/commonwealth-games/glasgow-2026'
    );
  });
});
