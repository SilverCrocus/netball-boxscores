import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
  NAVIGATION_PERFORMANCE_SCHEMA,
  evaluateNavigationPerformance,
  nearestRank,
  renderNavigationPerformanceMarkdown,
  summarizeNavigationSamples,
  type NavigationPerformanceReport,
  type NavigationSample,
} from '@/lib/navigation-performance-monitor';

function sample(
  overrides: Partial<NavigationSample> = {},
): NavigationSample {
  return {
    transitionId: 'records-to-rankings',
    profile: 'desktop',
    interaction: 'pointer',
    sample: 1,
    sourcePath: '/records',
    targetPath: '/rankings',
    durationMs: 100,
    acknowledgementMs: 20,
    intentPrefetchWaitMs: 100,
    intentTargetRscRequests: 1,
    intentTargetRscSettled: 1,
    postClickTargetRscRequests: 0,
    consoleErrors: 0,
    ignoredKnownConsoleErrors: 0,
    pageErrors: 0,
    unexpectedRequestFailures: 0,
    benignAbortedRscRequests: 0,
    serverErrors: 0,
    ...overrides,
  };
}

describe('navigation performance monitor policy', () => {
  it('uses deterministic nearest-rank quantiles', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);

    expect(nearestRank(values, 0.5)).toBe(10);
    expect(nearestRank(values, 0.95)).toBe(19);
    expect(() => nearestRank(values, 0)).toThrow(
      'Percentile must be greater than zero and at most one',
    );
  });

  it('treats a fast route commit as acknowledgement when no pending UI paints', () => {
    const summaries = summarizeNavigationSamples([
      sample({ acknowledgementMs: null, durationMs: 40 }),
      sample({ sample: 2, acknowledgementMs: null, durationMs: 80 }),
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      durationP50Ms: 40,
      durationP95Ms: 80,
      acknowledgementP50Ms: 40,
      acknowledgementP95Ms: 80,
    });
  });

  it('fails slow navigation, missing samples, and post-click target RSC traffic', () => {
    const summaries = summarizeNavigationSamples([
      sample({
        durationMs: 2_100,
        acknowledgementMs: null,
        postClickTargetRscRequests: 1,
      }),
    ]);
    const gates = evaluateNavigationPerformance({
      summaries,
      configuredSamples: 20,
      idlePrefetch: {
        route: '/records',
        observedForMs: 3_000,
        emittedRscRequests: 9,
        completedRscRequests: 9,
        completedRscBytes: 21_000,
        benignAbortedRscRequests: 0,
        unexpectedRequestFailures: 0,
        serverErrors: 0,
      },
      policyContracts: [{
        id: 'save-data-records-to-rankings',
        profile: 'mobile',
        sourcePath: '/records',
        targetPath: '/rankings',
        preClickTargetRscRequests: 1,
        observationMs: 750,
      }],
    });

    expect(gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id))
      .toEqual(expect.arrayContaining([
        'samples:desktop/pointer/records-to-rankings',
        'route-p95:desktop/pointer/records-to-rankings',
        'acknowledgement-p95:desktop/pointer/records-to-rankings',
        'post-click-rsc:desktop/pointer/records-to-rankings',
        'idle-prefetch-requests',
        'idle-prefetch-bytes',
        'policy:save-data-records-to-rankings',
      ]));
  });

  it('keeps unavailable transfer sizes observational rather than failing', () => {
    const summaries = summarizeNavigationSamples([sample()]);
    const gates = evaluateNavigationPerformance({
      summaries,
      configuredSamples: 1,
      idlePrefetch: {
        route: '/records',
        observedForMs: 3_000,
        emittedRscRequests: 1,
        completedRscRequests: 1,
        completedRscBytes: null,
        benignAbortedRscRequests: 0,
        unexpectedRequestFailures: 0,
        serverErrors: 0,
      },
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes')?.status)
      .toBe('observe');
  });

  it('reports the known analytics CSP message without treating it as a regression', () => {
    const summaries = summarizeNavigationSamples([
      sample({ ignoredKnownConsoleErrors: 2 }),
    ]);
    const gates = evaluateNavigationPerformance({
      summaries,
      configuredSamples: 1,
      idlePrefetch: {
        route: '/records',
        observedForMs: 3_000,
        emittedRscRequests: 1,
        completedRscRequests: 1,
        completedRscBytes: 1_000,
        benignAbortedRscRequests: 0,
        unexpectedRequestFailures: 0,
        serverErrors: 0,
      },
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id.startsWith('runtime-errors:'))?.status)
      .toBe('pass');
    expect(summaries[0]?.ignoredKnownConsoleErrors).toBe(2);
  });

  it('renders a compact report with release and budget posture', () => {
    const samples = [sample()];
    const summaries = summarizeNavigationSamples(samples);
    const gates = evaluateNavigationPerformance({
      summaries,
      configuredSamples: 1,
      idlePrefetch: {
        route: '/records',
        observedForMs: 3_000,
        emittedRscRequests: 1,
        completedRscRequests: 1,
        completedRscBytes: 1_000,
        benignAbortedRscRequests: 0,
        unexpectedRequestFailures: 0,
        serverErrors: 0,
      },
      policyContracts: [],
    });
    const report: NavigationPerformanceReport = {
      schema: NAVIGATION_PERFORMANCE_SCHEMA,
      startedAt: '2026-07-24T00:00:00.000Z',
      completedAt: '2026-07-24T00:05:00.000Z',
      baseUrl: 'https://www.centrepass.io',
      expectedRelease: 'abc123',
      observedRelease: 'abc123',
      health: { status: 200, ok: true, latencyMs: 10 },
      readiness: { status: 200, ok: true, latencyMs: 20 },
      configuredSamples: 1,
      budgets: DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
      summaries,
      samples,
      idlePrefetch: {
        route: '/records',
        observedForMs: 3_000,
        emittedRscRequests: 1,
        completedRscRequests: 1,
        completedRscBytes: 1_000,
        benignAbortedRscRequests: 0,
        unexpectedRequestFailures: 0,
        serverErrors: 0,
      },
      policyContracts: [],
      gates,
      passed: true,
      budgetsEnforced: false,
    };

    const markdown = renderNavigationPerformanceMarkdown(report);
    expect(markdown).toContain('PASS (report-only budgets)');
    expect(markdown).toContain('`abc123`');
    expect(markdown).toContain('| desktop | pointer | records-to-rankings |');
  });
});
