import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeAge } from './format';

describe('computeAge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes age correctly for a known date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24'));
    expect(computeAge(new Date('1997-08-26'))).toBe(28);
  });

  it('returns age before birthday this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24'));
    expect(computeAge(new Date('1997-12-15'))).toBe(28);
  });

  it('returns age on birthday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26'));
    expect(computeAge(new Date('1997-08-26'))).toBe(29);
  });

  it('handles leap year birthdays', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01'));
    expect(computeAge(new Date('2000-02-29'))).toBe(26);
  });
});
