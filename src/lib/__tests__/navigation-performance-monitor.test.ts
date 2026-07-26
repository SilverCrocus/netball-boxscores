import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
  MIN_ENFORCED_NAVIGATION_SAMPLES,
  NAVIGATION_PERFORMANCE_SCHEMA,
  calculateNavigationTiming,
  classifyNavigationMonitorFailure,
  countPreClickTargetRscRequests,
  evaluateNavigationPerformance,
  nearestRank,
  renderNavigationPerformanceMarkdown,
  shouldFailNavigationMonitor,
  summarizeNavigationSamples,
  validateNavigationPerformanceSamplePolicy,
  type IdlePrefetchMeasurement,
  type NavigationPerformanceReport,
  type NavigationSample,
} from '@/lib/navigation-performance-monitor';

function idle(
  overrides: Partial<IdlePrefetchMeasurement> = {},
): IdlePrefetchMeasurement {
  return {
    route: '/records',
    observedForMs: 3_000,
    emittedRscRequests: 1,
    settledRscRequests: 1,
    completedRscRequests: 1,
    sizedRscRequests: 1,
    completedRscBytes: 1_000,
    benignAbortedRscRequests: 0,
    unexpectedRequestFailures: 0,
    serverErrors: 0,
    ...overrides,
  };
}

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
    intentTargetRscCompleted: 1,
    intentTargetRscSized: 1,
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

  it('measures route duration at destination readiness without later read delay', () => {
    expect(calculateNavigationTiming(1_000, 1_040, 12.34)).toEqual({
      durationMs: 40,
      acknowledgementMs: 12.3,
    });
  });

  it('counts target RSC emitted during source render in pre-click policy evidence', () => {
    expect(countPreClickTargetRscRequests(1, 0)).toBe(1);
    expect(countPreClickTargetRscRequests(1, 2)).toBe(3);
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
      idlePrefetch: idle({
        emittedRscRequests: 9,
        settledRscRequests: 9,
        completedRscRequests: 9,
        sizedRscRequests: 9,
        completedRscBytes: 21_000,
      }),
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
      idlePrefetch: idle({
        completedRscBytes: null,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes')?.status)
      .toBe('observe');
  });

  it('fails incomplete idle evidence while emitted RSC requests remain unsettled', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 2,
        settledRscRequests: 1,
        completedRscRequests: 1,
        sizedRscRequests: 1,
        completedRscBytes: 0,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('fail');
    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes')?.status)
      .toBe('fail');
  });

  it('fails idle evidence when a completed RSC response was not sized', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 2,
        settledRscRequests: 2,
        completedRscRequests: 2,
        sizedRscRequests: 1,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('fail');
  });

  it('fails idle byte evidence when an emitted RSC settles without completing', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 2,
        settledRscRequests: 2,
        completedRscRequests: 1,
        sizedRscRequests: 1,
        completedRscBytes: 0,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('fail');
    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes')?.status)
      .toBe('fail');
  });

  it('requires a completed and sized target intent prefetch in every consumed-intent sample', () => {
    const missingIntent = summarizeNavigationSamples([
      sample({
        intentTargetRscRequests: 0,
        intentTargetRscSettled: 0,
        intentTargetRscCompleted: 0,
        intentTargetRscSized: 0,
      }),
      sample({
        sample: 2,
        intentTargetRscRequests: 2,
        intentTargetRscSettled: 2,
        intentTargetRscCompleted: 2,
        intentTargetRscSized: 2,
      }),
    ]);
    const unsettledIntent = summarizeNavigationSamples([
      sample({
        intentTargetRscRequests: 1,
        intentTargetRscSettled: 0,
        intentTargetRscCompleted: 0,
        intentTargetRscSized: 0,
      }),
    ]);
    const failedIntent = summarizeNavigationSamples([
      sample({
        intentTargetRscRequests: 1,
        intentTargetRscSettled: 1,
        intentTargetRscCompleted: 0,
        intentTargetRscSized: 0,
      }),
    ]);
    const unsizedIntent = summarizeNavigationSamples([
      sample({
        intentTargetRscRequests: 1,
        intentTargetRscSettled: 1,
        intentTargetRscCompleted: 1,
        intentTargetRscSized: 0,
      }),
    ]);

    for (const summaries of [
      missingIntent,
      unsettledIntent,
      failedIntent,
      unsizedIntent,
    ]) {
      const gates = evaluateNavigationPerformance({
        summaries,
        configuredSamples: summaries[0]?.count ?? 1,
        idlePrefetch: idle(),
        policyContracts: [],
      });
      expect(gates.find((gate) => gate.id.startsWith('intent-prefetch:'))?.status)
        .toBe('fail');
    }
  });

  it('fails report-only runs when idle-prefetch evidence is incomplete', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 2,
        settledRscRequests: 1,
        completedRscRequests: 1,
        sizedRscRequests: 1,
      }),
      policyContracts: [],
    });

    expect(shouldFailNavigationMonitor(gates, false)).toBe(true);
  });

  it('keeps a route-budget-only miss nonfatal in report-only mode', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([
        sample({ durationMs: 2_100 }),
      ]),
      configuredSamples: 1,
      idlePrefetch: idle(),
      policyContracts: [],
    });

    expect(gates.filter((gate) => gate.status === 'fail').map(({ id }) => id))
      .toEqual(['route-p95:desktop/pointer/records-to-rankings']);
    expect(shouldFailNavigationMonitor(gates, false)).toBe(false);
    expect(shouldFailNavigationMonitor(gates, true)).toBe(true);
  });

  it('allows one-sample report-only diagnostics but rejects undersized enforcement', () => {
    expect(() => validateNavigationPerformanceSamplePolicy(1, false))
      .not.toThrow();
    expect(() => validateNavigationPerformanceSamplePolicy(
      MIN_ENFORCED_NAVIGATION_SAMPLES - 1,
      true,
    )).toThrow(`at least ${MIN_ENFORCED_NAVIGATION_SAMPLES} samples`);

    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: MIN_ENFORCED_NAVIGATION_SAMPLES - 1,
      idlePrefetch: idle(),
      policyContracts: [],
      budgetsEnforced: true,
    });
    expect(gates.find((gate) => gate.id === 'minimum-enforced-samples')?.status)
      .toBe('fail');
  });

  it('maps raw failures to stable retained evidence without URLs or identifiers', () => {
    const raw = new Error(
      'desktop/pointer/records-to-rankings sample 1: https://example.test/match/private-id?_rsc=secret',
    );
    const failure = classifyNavigationMonitorFailure(raw);

    expect(failure).toEqual({
      code: 'navigation_sample_failed',
      message: 'A navigation sample could not be completed.',
    });
    expect(JSON.stringify(failure)).not.toContain('private-id');
    expect(JSON.stringify(failure)).not.toContain('_rsc');
  });

  it('reports the known analytics CSP message without treating it as a regression', () => {
    const summaries = summarizeNavigationSamples([
      sample({ ignoredKnownConsoleErrors: 2 }),
    ]);
    const gates = evaluateNavigationPerformance({
      summaries,
      configuredSamples: 1,
      idlePrefetch: idle(),
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
      idlePrefetch: idle(),
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
      idlePrefetch: idle(),
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
