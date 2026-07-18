import { describe, expect, it, vi } from 'vitest';
import {
  navigateAfterSignIn,
  safeSignInCallbackUrl,
} from '@/lib/sign-in-navigation';

describe('sign-in navigation boundary', () => {
  it.each([
    ['/admin/preview/glasgow-2026', '/admin/preview/glasgow-2026'],
    ['/match/match-1?edition=ssn-2026', '/match/match-1?edition=ssn-2026'],
    ['https://attacker.example/steal', '/'],
    ['//attacker.example/steal', '/'],
    ['/\\attacker.example/steal', '/'],
    [null, '/'],
  ])('normalizes callback %s without permitting an open redirect', (value, expected) => {
    expect(safeSignInCallbackUrl(value)).toBe(expected);
  });

  it('uses a full-document transition for the fixed private preview callback', () => {
    const assign = vi.fn();
    navigateAfterSignIn(
      'https://centrepass.test/admin/preview/glasgow-2026',
      { origin: 'https://centrepass.test', assign },
    );

    expect(assign).toHaveBeenCalledWith('/admin/preview/glasgow-2026');
  });

  it('fails closed instead of navigating to a cross-origin sign-in result', () => {
    const assign = vi.fn();
    navigateAfterSignIn(
      'https://attacker.example/steal',
      { origin: 'https://centrepass.test', assign },
    );

    expect(assign).toHaveBeenCalledWith('/');
  });
});
