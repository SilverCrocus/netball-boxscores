import { describe, it, expect } from 'vitest';

describe('Auth Middleware Config', () => {
  it('should export a config with protected routes', async () => {
    const { config } = await import('@/middleware');
    expect(config.matcher).toContain('/settings/:path*');
  });
});
