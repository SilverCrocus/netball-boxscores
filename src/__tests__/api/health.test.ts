import { describe, it, expect } from 'vitest';

describe('Health API', () => {
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
});
