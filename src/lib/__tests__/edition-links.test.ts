import { describe, expect, it } from 'vitest';
import type { EditionContextValue } from '@/lib/edition-context';
import {
  editionAwareNavigationHref,
  editionContextFromPathname,
  editionHref,
  editionNavigationHref,
  editionScopedHref,
  editionSwitchHref,
  isCanonicalMatchEdition,
  matchHref,
  navigationEditionFromPathname,
  navigationEditionFromLocation,
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

const hostedPreview: EditionContextValue = {
  ...glasgow,
  id: 'glasgow-preview',
  navigationOrigin: 'https://www.centrepass.io',
};

describe('edition links', () => {
  it('uses a hosted origin only for an explicit preview edition', () => {
    expect(editionHref(hostedPreview)).toBe(
      'https://www.centrepass.io/competitions/commonwealth-games/glasgow-2026',
    );
    expect(editionHref(hostedPreview, 'standings')).toBe(
      'https://www.centrepass.io/competitions/commonwealth-games/glasgow-2026/standings',
    );
    expect(editionHref(glasgow)).toBe(
      '/competitions/commonwealth-games/glasgow-2026',
    );
  });

  it('builds canonical links for edition destinations', () => {
    expect(editionHref(ssn, 'standings')).toBe(
      '/competitions/suncorp-super-netball/2026/standings'
    );
  });

  it('scopes legacy detail links to a canonical edition without breaking legacy callers', () => {
    expect(editionScopedHref('/match/match-1', 'ssn 2026')).toBe(
      '/match/match-1?edition=ssn%202026'
    );
    expect(editionScopedHref('/player/player-1?view=form', 'glasgow-2026')).toBe(
      '/player/player-1?view=form&edition=glasgow-2026'
    );
    expect(editionScopedHref('/match/legacy-match')).toBe('/match/legacy-match');
  });

  it('builds canonical match, live, and court URLs from the owning edition', () => {
    expect(matchHref('match 1', 'ssn-2026')).toBe('/match/match%201?edition=ssn-2026');
    expect(matchHref('match-1', 'glasgow-2026', 'live')).toBe(
      '/match/match-1/live?edition=glasgow-2026',
    );
    expect(matchHref('match-1', 'glasgow-2026', 'court')).toBe(
      '/match/match-1/court?edition=glasgow-2026',
    );
    expect(isCanonicalMatchEdition('ssn-2026', 'ssn-2026')).toBe(true);
    expect(isCanonicalMatchEdition('glasgow-2026', 'ssn-2026')).toBe(false);
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

  it('switches a preview edition to its hosted route while preserving the section', () => {
    expect(editionSwitchHref(
      hostedPreview,
      '/competitions/suncorp-super-netball/2026/teams',
    )).toBe(
      'https://www.centrepass.io/competitions/commonwealth-games/glasgow-2026/teams',
    );
  });

  it('preserves supported legacy sections when switching editions', () => {
    expect(editionSwitchHref(glasgow, '/standings')).toBe(
      '/competitions/commonwealth-games/glasgow-2026/standings'
    );
  });

  it('resolves edition paths exactly without falling back on unknown slugs', () => {
    const editions = [ssn, glasgow];

    expect(editionContextFromPathname(
      editions,
      '/competitions/commonwealth-games/glasgow-2026/teams'
    )).toBe(glasgow);
    expect(navigationEditionFromPathname(
      editions,
      '/competitions/commonwealth-games/not-an-edition'
    )).toBeNull();
  });

  it('scopes edition-aware global navigation while retaining global-only pages', () => {
    expect(editionAwareNavigationHref(glasgow, '/')).toBe(
      '/competitions/commonwealth-games/glasgow-2026'
    );
    expect(editionAwareNavigationHref(glasgow, '/teams')).toBe(
      '/competitions/commonwealth-games/glasgow-2026/teams'
    );
    expect(editionAwareNavigationHref(glasgow, '/rankings')).toBe('/rankings');
  });

  it('preserves a canonical edition on legacy detail routes', () => {
    expect(navigationEditionFromLocation(
      [glasgow, ssn],
      '/team/melbourne-vixens',
      'ssn-2026',
    )).toBe(ssn);
    expect(navigationEditionFromLocation(
      [glasgow, ssn],
      '/team/melbourne-vixens',
      'unknown-edition',
    )).toBeNull();
  });

  it('falls back to the edition landing path for unrelated routes', () => {
    expect(editionSwitchHref(glasgow, '/match/abc')).toBe(
      '/competitions/commonwealth-games/glasgow-2026'
    );
  });
});
