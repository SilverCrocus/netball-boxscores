import { describe, it, expect } from 'vitest';

describe('Auth Proxy Config', () => {
  it('should export a config with protected routes', async () => {
    const { config } = await import('@/proxy');
    expect(config.matcher).toContain('/settings/:path*');
  });
});
