import { afterEach, describe, it, expect, vi } from 'vitest';

describe('Health API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should export a GET handler', async () => {
    const { GET } = await import('@/app/api/health/route');
    expect(typeof GET).toBe('function');
  });

  it('should return 200 with status ok', async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.type).toBe('liveness');
    expect(data.timestamp).toBeDefined();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('identifies the exact Render release when deployment metadata is available', async () => {
    vi.stubEnv('RENDER_GIT_COMMIT', 'abc123');
    vi.stubEnv('RENDER_GIT_BRANCH', 'main');
    const { GET } = await import('@/app/api/health/route');

    const response = await GET();
    const data = await response.json();

    expect(data.release).toEqual({
      commit: 'abc123',
      branch: 'main',
      node: process.version,
    });
    expect(data.version).toBe('0.1.0');
  });
});
