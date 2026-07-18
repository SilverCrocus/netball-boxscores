import { describe, expect, it } from 'vitest';
import { assertInvalidationLimit } from '@/lib/analytics/cache-invalidation';

describe('analytics invalidation bounds', () => {
  it.each([1, 100, 500])('accepts bounded batch size %s', (limit) => {
    expect(() => assertInvalidationLimit(limit)).not.toThrow();
  });

  it.each([0, 501, 1.5])('rejects unsafe batch size %s', (limit) => {
    expect(() => assertInvalidationLimit(limit)).toThrow();
  });
});
