import { describe, expect, it } from 'vitest';
import {
  clientIdentifier,
  consumeRateLimit,
  isSameOriginRequest,
  readJsonObjectWithinLimit,
} from '@/lib/request-security';

describe('request security helpers', () => {
  it('accepts only valid proxy IP values', () => {
    expect(clientIdentifier(new Headers({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' })))
      .toBe('203.0.113.10');
    expect(clientIdentifier(new Headers({ 'x-forwarded-for': 'attacker-controlled' })))
      .toBe('unknown');
  });

  it('enforces a fixed-window limit without retaining clear identifiers', () => {
    const input = { scope: 'test-limit', identifier: 'private@example.test', limit: 2, windowMs: 1_000, now: 100 };
    expect(consumeRateLimit(input).allowed).toBe(true);
    expect(consumeRateLimit(input).allowed).toBe(true);
    expect(consumeRateLimit(input)).toMatchObject({ allowed: false, remaining: 0 });
    expect(consumeRateLimit({ ...input, now: 1_101 }).allowed).toBe(true);
  });

  it('rejects cross-origin mutations', () => {
    expect(isSameOriginRequest(new Request('https://centrepass.example/api', {
      headers: { Origin: 'https://centrepass.example' },
    }))).toBe(true);
    expect(isSameOriginRequest(new Request('https://centrepass.example/api', {
      headers: { Origin: 'https://evil.example' },
    }))).toBe(false);
  });

  it('bounds and validates JSON object bodies', async () => {
    await expect(readJsonObjectWithinLimit(new Request('https://centrepass.example/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'too-large' }),
    }), 8)).resolves.toMatchObject({ ok: false, status: 413 });

    await expect(readJsonObjectWithinLimit(new Request('https://centrepass.example/api', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    }), 100)).resolves.toMatchObject({ ok: false, status: 415 });
  });
});
