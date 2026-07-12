import { describe, expect, it } from 'vitest';
import { getSydneyDayBounds } from '@/lib/time-zone';

describe('getSydneyDayBounds', () => {
  it('uses AEDT in January', () => {
    const bounds = getSydneyDayBounds(new Date('2026-01-15T01:00:00Z'));

    expect(bounds.start.toISOString()).toBe('2026-01-14T13:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-01-15T13:00:00.000Z');
  });

  it('uses AEST in July', () => {
    const bounds = getSydneyDayBounds(new Date('2026-07-15T01:00:00Z'));

    expect(bounds.start.toISOString()).toBe('2026-07-14T14:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-07-15T14:00:00.000Z');
  });

  it('returns a 25-hour day when daylight saving ends', () => {
    const bounds = getSydneyDayBounds(new Date('2026-04-05T03:00:00Z'));

    expect(bounds.start.toISOString()).toBe('2026-04-04T13:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-04-05T14:00:00.000Z');
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('returns a 23-hour day when daylight saving starts', () => {
    const bounds = getSydneyDayBounds(new Date('2026-10-04T03:00:00Z'));

    expect(bounds.start.toISOString()).toBe('2026-10-03T14:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-10-04T13:00:00.000Z');
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
