import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonWithinLimits } from '@/lib/bounded-fetch';

describe('fetchJsonWithinLimits', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns bounded JSON and applies a timeout signal', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await expect(fetchJsonWithinLimits<{ ok: boolean }>({
      url: 'https://upstream.example/data',
      label: 'Upstream',
      timeoutMs: 1_000,
      maxBytes: 100,
      init: { cache: 'no-store' },
    })).resolves.toEqual({ ok: true });

    expect(fetchSpy).toHaveBeenCalledWith('https://upstream.example/data', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
  });

  it('rejects a declared oversized response without parsing it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      headers: { 'Content-Length': '101' },
    }));

    await expect(fetchJsonWithinLimits({
      url: 'https://upstream.example/data',
      label: 'Upstream',
      timeoutMs: 1_000,
      maxBytes: 100,
    })).rejects.toThrow('Upstream response exceeded 100 bytes');
  });

  it('does not echo a potentially sensitive URL in errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));

    await expect(fetchJsonWithinLimits({
      url: 'https://user:secret@upstream.example/data?token=private',
      label: 'Upstream',
      timeoutMs: 1_000,
      maxBytes: 100,
    })).rejects.toThrow('Upstream error: 503');
  });
});
