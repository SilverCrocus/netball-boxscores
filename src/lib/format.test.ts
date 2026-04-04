import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeAge, formatMatchDateTime } from './format';

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

describe('formatMatchDateTime', () => {
  it('formats date and time on one line', () => {
    // April 5 2026 at 05:00 UTC = 3:00 PM AEST
    const result = formatMatchDateTime(new Date('2026-04-05T05:00:00Z'));
    expect(result).toContain('Sun');
    expect(result).toContain('5');
    expect(result).toContain('Apr');
    expect(result).toContain('3:00');
    expect(result).toContain('pm');
  });

  it('does not pad single-digit hours', () => {
    const result = formatMatchDateTime(new Date('2026-04-05T05:00:00Z'));
    expect(result).not.toContain('03:00');
  });

  it('accepts string dates', () => {
    const result = formatMatchDateTime('2026-04-05T05:00:00Z');
    expect(result).toContain('Apr');
    expect(result).toContain('3:00');
  });
});
