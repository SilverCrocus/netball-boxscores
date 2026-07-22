import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';

describe('Next cache memory policy', () => {
  it('disables only the process-local cache while retaining the filesystem handler', () => {
    expect(nextConfig.cacheMaxMemorySize).toBe(0);
    expect(nextConfig.cacheHandler).toBeUndefined();
    expect(nextConfig.experimental?.cacheComponents).not.toBe(true);
  });
});
