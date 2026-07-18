import { describe, expect, it } from 'vitest';
import { countryFlagForTeam } from '@/lib/country-flags';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('countryFlagForTeam', () => {
  it.each([
    ['Australia', 'AUS', '/flags/glasgow-2026/au.svg'],
    ['England', 'ENG', '/flags/glasgow-2026/gb-eng.svg'],
    ['South Africa', 'RSA', '/flags/glasgow-2026/za.svg'],
    ['Malawi', 'MWI', '/flags/glasgow-2026/mw.svg'],
    ['Tonga', 'TON', '/flags/glasgow-2026/to.svg'],
    ['Northern Ireland', 'NIR', '/flags/glasgow-2026/gb-nir.svg'],
    ['New Zealand', 'NZL', '/flags/glasgow-2026/nz.svg'],
    ['Jamaica', 'JAM', '/flags/glasgow-2026/jm.svg'],
    ['Wales', 'WAL', '/flags/glasgow-2026/gb-wls.svg'],
    ['Uganda', 'UGA', '/flags/glasgow-2026/ug.svg'],
    ['Scotland', 'SCO', '/flags/glasgow-2026/gb-sct.svg'],
    ['Trinidad & Tobago', 'TTO', '/flags/glasgow-2026/tt.svg'],
  ])('maps %s (%s) to its flag', (name, abbreviation, expected) => {
    const flagPath = countryFlagForTeam({ name, abbreviation });
    expect(flagPath).toBe(expected);
    expect(existsSync(join(process.cwd(), 'public', expected.replace(/^\//, '')))).toBe(true);
  });

  it('uses the country name when an upstream abbreviation differs', () => {
    expect(countryFlagForTeam({ name: 'Malawi', abbreviation: 'MAW' })).toBe(
      '/flags/glasgow-2026/mw.svg',
    );
  });

  it('leaves club teams on the normal abbreviation fallback', () => {
    expect(countryFlagForTeam({ name: 'Melbourne Vixens', abbreviation: 'VIX' })).toBeNull();
  });
});
