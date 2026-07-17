import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  executeProductionSmoke,
  MAX_RESPONSE_BODY_BYTES,
  parseProductionSmokeArguments,
  renderProductionSmokeMarkdown,
  writeProductionSmokeEvidence,
} from '../../../scripts/production-smoke';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const SSN_MATCH_ID = 'ssn-match-1';
const SSN_EDITION_ID = 'ssn-edition-id';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(value: string): Response {
  return new Response(`<html><body>${value}</body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function healthyFetch(phase: 'baseline' | 'published' = 'published'): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === '/api/health') {
      return jsonResponse({
        status: 'ok',
        type: 'liveness',
        timestamp: '2026-07-17T00:00:00.000Z',
        release: { commit: COMMIT },
      });
    }
    if (url.pathname === '/api/readiness') {
      return jsonResponse({
        status: 'ready',
        type: 'readiness',
        timestamp: '2026-07-17T00:00:00.000Z',
        checks: {
          database: { ok: true },
          worker: {
            ok: true,
            enabled: true,
            required: true,
            state: 'healthy',
            satisfiesReadiness: true,
            isHealthy: true,
            lastPollAt: '2026-07-16T23:59:55.000Z',
            lastPollStatus: 'success',
            currentIntervalMs: 10_000,
          },
          analytics: phase === 'published'
            ? { enabled: true, state: 'healthy', satisfiesReadiness: true }
            : { enabled: false, state: 'disabled', satisfiesReadiness: true },
          statsOperations: phase === 'published'
            ? { enabled: true, state: 'healthy', satisfiesReadiness: true }
            : { enabled: false, state: 'disabled', satisfiesReadiness: true },
        },
      });
    }
    if (url.pathname === '/api/matches') {
      return jsonResponse({
        groups: [{
          matches: [{
            id: SSN_MATCH_ID,
            competitionId: SSN_EDITION_ID,
            scoreAvailable: true,
          }],
        }],
        nextCursor: null,
      });
    }
    if (url.pathname === `/match/${SSN_MATCH_ID}`) {
      return new Response(null, {
        status: 307,
        headers: { location: `/match/${SSN_MATCH_ID}?edition=${SSN_EDITION_ID}` },
      });
    }
    if (url.pathname === '/') return htmlResponse('CentrePass Results');
    if (url.pathname.includes('/competitions/commonwealth-games-netball/glasgow-2026') && phase === 'published') {
      return htmlResponse('Glasgow 2026 Pool A Australia');
    }
    if (url.pathname === '/rankings' && phase === 'published') return htmlResponse('CentrePass Rankings');
    if (url.pathname === '/records' && phase === 'published') return htmlResponse('CentrePass Records');
    if (url.pathname === '/compare/players' && phase === 'published') return htmlResponse('Compare Players');
    if (url.pathname === '/explore' && phase === 'published') return htmlResponse('Ask CentrePass');
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('production smoke', () => {
  it('requires a full commit and normalizes the base URL', () => {
    expect(parseProductionSmokeArguments([
      '--base-url', 'https://www.centrepass.io/path?ignored=true',
      '--expected-commit', COMMIT.toUpperCase(),
      '--phase', 'published',
      '--output-dir', './evidence',
    ])).toMatchObject({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 8_000,
      retries: 2,
    });

    expect(() => parseProductionSmokeArguments([
      '--base-url', 'https://www.centrepass.io',
      '--expected-commit', 'short-sha',
      '--phase', 'published',
      '--output-dir', './evidence',
    ])).toThrow('full 40-character Git SHA');

    expect(() => parseProductionSmokeArguments([
      '--base-url', 'https://user:secret@www.centrepass.io',
      '--expected-commit', COMMIT,
      '--phase', 'published',
      '--output-dir', './evidence',
    ])).toThrow('must not contain credentials');

    expect(() => parseProductionSmokeArguments([
      '--base-url', 'http://www.centrepass.io',
      '--expected-commit', COMMIT,
      '--phase', 'published',
      '--output-dir', './evidence',
    ])).toThrow('must use HTTPS');

    expect(() => parseProductionSmokeArguments([
      '--base-url', 'https://www.centrepass.io',
      '--expected-commit', COMMIT,
      '--phase', 'published',
      '--output-dir', './evidence',
      '--timeout-ms', '0',
    ])).toThrow('must be an integer from 1 to 60000');
  });

  it('verifies the public production surfaces and owning-edition redirect', async () => {
    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 100,
      retries: 0,
    }, healthyFetch());

    expect(evidence.summary).toEqual({
      passed: true,
      passedChecks: 10,
      failedChecks: 0,
      totalChecks: 10,
    });
    expect(evidence.checks.find((check) => check.name === 'Canonical match-edition redirect')).toMatchObject({
      passed: true,
      request: { status: 307 },
    });
    expect(renderProductionSmokeMarkdown(evidence)).toContain('**PASS** (10/10)');
  });

  it('verifies the pre-feature baseline and fail-closed routes', async () => {
    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'baseline',
      timeoutMs: 100,
      retries: 0,
    }, healthyFetch('baseline'));

    expect(evidence.summary.passed).toBe(true);
    expect(evidence.phase).toBe('baseline');
    expect(evidence.checks.find((check) => check.name === 'Unpublished Glasgow fail-closed boundary')).toMatchObject({
      passed: true,
      request: { status: 404 },
    });
  });

  it('fails when analytics is disabled even though readiness returns HTTP 200', async () => {
    const fetchImpl = healthyFetch() as ReturnType<typeof vi.fn>;
    fetchImpl.mockImplementationOnce(async () => jsonResponse({
      status: 'ok',
      type: 'liveness',
      timestamp: '2026-07-17T00:00:00.000Z',
      release: { commit: COMMIT },
    }));
    fetchImpl.mockImplementationOnce(async () => jsonResponse({
      status: 'ready',
      type: 'readiness',
      timestamp: '2026-07-17T00:00:00.000Z',
      checks: {
        database: { ok: true },
        worker: {
          ok: true,
          enabled: true,
          required: true,
          state: 'healthy',
          satisfiesReadiness: true,
          isHealthy: true,
          lastPollAt: '2026-07-16T23:59:55.000Z',
          lastPollStatus: 'success',
          currentIntervalMs: 10_000,
        },
        analytics: { enabled: false, state: 'disabled', satisfiesReadiness: true },
        statsOperations: { enabled: false, state: 'disabled', satisfiesReadiness: true },
      },
    }));

    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 100,
      retries: 0,
    }, fetchImpl as typeof fetch);

    expect(evidence.summary.passed).toBe(false);
    expect(evidence.checks.find((check) => check.name === 'Readiness and scoped database boundaries')).toMatchObject({
      passed: false,
      error: 'analytics is not enabled and healthy',
    });
  });

  it('rejects an incomplete worker contract even when readiness returns HTTP 200', async () => {
    const fetchImpl = healthyFetch() as ReturnType<typeof vi.fn>;
    fetchImpl.mockImplementationOnce(async () => jsonResponse({
      status: 'ok',
      type: 'liveness',
      timestamp: '2026-07-17T00:00:00.000Z',
      release: { commit: COMMIT },
    }));
    fetchImpl.mockImplementationOnce(async () => jsonResponse({
      status: 'ready',
      type: 'readiness',
      timestamp: '2026-07-17T00:00:00.000Z',
      checks: {
        database: { ok: true },
        worker: {
          ok: true,
          enabled: true,
          required: false,
          state: 'healthy',
          satisfiesReadiness: true,
          isHealthy: true,
          lastPollAt: '2026-07-16T23:59:55.000Z',
          lastPollStatus: 'success',
          currentIntervalMs: 10_000,
        },
        analytics: { enabled: true, state: 'healthy', satisfiesReadiness: true },
        statsOperations: { enabled: true, state: 'healthy', satisfiesReadiness: true },
      },
    }));

    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 100,
      retries: 0,
    }, fetchImpl as typeof fetch);

    expect(evidence.checks.find((check) => check.name === 'Readiness and scoped database boundaries')).toMatchObject({
      passed: false,
      error: 'worker is not enabled, required, healthy, and readiness-satisfying',
    });
  });

  it.each([
    ['missing isHealthy', { isHealthy: undefined }, 'worker is not enabled'],
    ['wrong poll status', { lastPollStatus: 'failed' }, 'lastPollStatus'],
    ['missing interval', { currentIntervalMs: undefined }, 'currentIntervalMs'],
    ['missing poll time', { lastPollAt: undefined }, 'lastPollAt is not a valid'],
    ['stale poll', { lastPollAt: '2026-07-16T23:59:30.000Z' }, 'lastPollAt is stale'],
    ['future poll', { lastPollAt: '2026-07-17T00:00:01.000Z' }, 'lastPollAt is stale'],
  ])('rejects worker readiness when %s', async (_label, override, expectedError) => {
    const fallback = healthyFetch();
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname !== '/api/readiness') return fallback(input, init);
      return jsonResponse({
        status: 'ready',
        type: 'readiness',
        timestamp: '2026-07-17T00:00:00.000Z',
        checks: {
          database: { ok: true },
          worker: {
            ok: true,
            enabled: true,
            required: true,
            state: 'healthy',
            satisfiesReadiness: true,
            isHealthy: true,
            lastPollAt: '2026-07-16T23:59:55.000Z',
            lastPollStatus: 'empty',
            currentIntervalMs: 10_000,
            ...override,
          },
          analytics: { enabled: true, state: 'healthy', satisfiesReadiness: true },
          statsOperations: { enabled: true, state: 'healthy', satisfiesReadiness: true },
        },
      });
    }) as typeof fetch;
    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 100,
      retries: 0,
    }, fetchImpl);
    expect(evidence.checks.find((check) => check.name === 'Readiness and scoped database boundaries')).toMatchObject({
      passed: false,
      error: expect.stringContaining(expectedError),
    });
  });

  it('fails closed on oversized bodies without retaining body samples', async () => {
    const fallback = healthyFetch();
    let first = true;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (first) {
        first = false;
        return new Response('x'.repeat(MAX_RESPONSE_BODY_BYTES + 1), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return fallback(input, init);
    }) as typeof fetch;
    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 100,
      retries: 2,
    }, fetchImpl);
    const health = evidence.checks[0]!;
    expect(health).toMatchObject({
      passed: false,
      request: { attempts: 1, status: 200, finalUrl: 'https://www.centrepass.io/api/health' },
      error: expect.stringContaining('response body exceeds'),
    });
    expect(health.request).not.toHaveProperty('bodySample');
  });

  it('rejects followed and manual cross-origin redirects and stores no unsafe URL', async () => {
    const fallback = healthyFetch();
    const followed = jsonResponse({
      status: 'ok',
      type: 'liveness',
      timestamp: '2026-07-17T00:00:00.000Z',
      release: { commit: COMMIT },
    });
    Object.defineProperty(followed, 'url', { value: 'https://attacker.example/collect?token=secret' });
    let first = true;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (first) {
        first = false;
        return followed;
      }
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === `/match/${SSN_MATCH_ID}`) {
        return new Response(null, { status: 307, headers: { location: 'https://attacker.example/secret?token=secret' } });
      }
      return fallback(input, init);
    }) as typeof fetch;
    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 100,
      retries: 0,
    }, fetchImpl);
    expect(evidence.checks[0]).toMatchObject({
      passed: false,
      request: { attempts: 1, finalUrl: 'https://www.centrepass.io/api/health', location: null },
      error: 'response followed a cross-origin redirect',
    });
    expect(evidence.checks.find((check) => check.name === 'Canonical match-edition redirect')).toMatchObject({
      passed: false,
      request: { finalUrl: 'https://www.centrepass.io/match/ssn-match-1', location: null },
      error: 'response contains a cross-origin redirect',
    });
    expect(JSON.stringify(evidence)).not.toContain('attacker.example');
    expect(JSON.stringify(evidence)).not.toContain('token=secret');
  });

  it('retains attempts and elapsed time after network retry exhaustion', async () => {
    const fallback = healthyFetch();
    let attempts = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      attempts += 1;
      if (attempts <= 3) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        throw new Error('network unavailable');
      }
      return fallback(input, init);
    }) as typeof fetch;

    const evidence = await executeProductionSmoke({
      baseUrl: 'https://www.centrepass.io',
      expectedCommit: COMMIT,
      phase: 'published',
      timeoutMs: 100,
      retries: 2,
    }, fetchImpl);

    expect(evidence.checks.find((check) => check.name === 'Liveness and deployed commit')).toMatchObject({
      passed: false,
      request: {
        status: null,
        attempts: 3,
      },
      error: 'network unavailable',
    });
    expect(evidence.checks[0]?.request.durationMs).toBeGreaterThan(0);
  });

  it('creates private evidence files without overwriting an existing run', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'centrepass-smoke-evidence-'));
    const directory = path.join(temporaryRoot, 'evidence');
    try {
      const evidence = await executeProductionSmoke({
        baseUrl: 'https://www.centrepass.io',
        expectedCommit: COMMIT,
        phase: 'baseline',
        timeoutMs: 100,
        retries: 0,
      }, healthyFetch('baseline'));
      const paths = await writeProductionSmokeEvidence(evidence, directory);

      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(paths.jsonPath)).mode & 0o777).toBe(0o600);
      expect((await stat(paths.markdownPath)).mode & 0o777).toBe(0o600);
      await expect(writeProductionSmokeEvidence(evidence, directory)).rejects.toMatchObject({
        code: 'EEXIST',
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('repairs a pre-existing permissive evidence directory before writing', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'centrepass-smoke-permissions-'));
    const directory = path.join(temporaryRoot, 'evidence');
    try {
      await mkdir(directory, { mode: 0o755 });
      await chmod(directory, 0o755);
      const evidence = await executeProductionSmoke({
        baseUrl: 'https://www.centrepass.io',
        expectedCommit: COMMIT,
        phase: 'baseline',
        timeoutMs: 100,
        retries: 0,
      }, healthyFetch('baseline'));
      const paths = await writeProductionSmokeEvidence(evidence, directory);

      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(paths.jsonPath)).mode & 0o777).toBe(0o600);
      expect((await stat(paths.markdownPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
