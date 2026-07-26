import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
  MIN_ENFORCED_NAVIGATION_SAMPLES,
  NAVIGATION_PERFORMANCE_SCHEMA,
  NavigationSampleMonitorError,
  calculateNavigationTiming,
  classifyNavigationMonitorFailure,
  countPreClickTargetRscRequests,
  createNavigationMonitorErrorReport,
  evaluateNavigationPerformance,
  navigationSampleLabel,
  nearestRank,
  renderNavigationMonitorErrorMarkdown,
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

  it('labels excluded warmups and measured sample ordinals stably', () => {
    expect(navigationSampleLabel(0)).toBe('warmup');
    expect(navigationSampleLabel(1)).toBe('measured-1');
    expect(navigationSampleLabel(20)).toBe('measured-20');
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
        emittedRscRequests: 0,
        settledRscRequests: 0,
        completedRscRequests: 0,
        sizedRscRequests: 0,
        completedRscBytes: null,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('pass');
    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes')?.status)
      .toBe('observe');
  });

  it('accepts production-shaped idle evidence with only benign aborts and zero bytes', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 8,
        settledRscRequests: 8,
        completedRscRequests: 0,
        sizedRscRequests: 0,
        completedRscBytes: 0,
        benignAbortedRscRequests: 8,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence'))
      .toMatchObject({
        status: 'pass',
        message: expect.stringContaining('8 benignly aborted'),
      });
    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes'))
      .toMatchObject({
        status: 'pass',
        message: expect.stringContaining('completed 0 idle RSC response-body bytes'),
      });
    expect(gates.find((gate) => gate.id === 'idle-prefetch-network-errors')?.status)
      .toBe('pass');
  });

  it('accepts mixed completed and benignly aborted idle terminal outcomes', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 2,
        settledRscRequests: 2,
        completedRscRequests: 1,
        sizedRscRequests: 1,
        completedRscBytes: 512,
        benignAbortedRscRequests: 1,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('pass');
    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes')?.status)
      .toBe('pass');
  });

  it('keeps HTTP 5xx separate from otherwise complete idle evidence', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({ serverErrors: 1 }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('pass');
    expect(gates.find((gate) => gate.id === 'idle-prefetch-network-errors')?.status)
      .toBe('fail');
  });

  it('fails unsized completed idle responses even when byte sizes are unavailable', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 2,
        settledRscRequests: 2,
        completedRscRequests: 2,
        sizedRscRequests: 1,
        completedRscBytes: null,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('fail');
    expect(gates.find((gate) => gate.id === 'idle-prefetch-bytes')?.status)
      .toBe('fail');
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

  it('fails idle evidence for a non-benign request failure', () => {
    const gates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples([sample()]),
      configuredSamples: 1,
      idlePrefetch: idle({
        emittedRscRequests: 2,
        settledRscRequests: 2,
        completedRscRequests: 1,
        sizedRscRequests: 1,
        unexpectedRequestFailures: 1,
      }),
      policyContracts: [],
    });

    expect(gates.find((gate) => gate.id === 'idle-prefetch-evidence')?.status)
      .toBe('fail');
    expect(gates.find((gate) => gate.id === 'idle-prefetch-network-errors')?.status)
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

  it('accepts production-shaped intent evidence with redundant warm-cache aborts', () => {
    const samples = Array.from({ length: 20 }, (_, index) => (
      sample({
        sample: index + 1,
        intentTargetRscRequests: 2,
        intentTargetRscSettled: 2,
        intentTargetRscCompleted: index === 0 ? 1 : 0,
        intentTargetRscSized: index === 0 ? 1 : 0,
      })
    ));
    const summaries = summarizeNavigationSamples(samples);
    const gates = evaluateNavigationPerformance({
      summaries,
      configuredSamples: 20,
      idlePrefetch: idle(),
      policyContracts: [],
    });

    expect(summaries[0]).toMatchObject({
      count: 20,
      intentRequestSamples: 20,
      intentSettledSamples: 20,
      intentTargetRscRequests: 40,
      intentTargetRscSettled: 40,
      intentTargetRscCompleted: 1,
      intentTargetRscSized: 1,
      consumedIntentSamples: 0,
    });
    expect(gates.find((gate) => gate.id.startsWith('intent-prefetch:')))
      .toMatchObject({
        status: 'pass',
        message: expect.stringContaining(
          'settled 40/40 before click across 20/20 sample(s)',
        ),
      });
    expect(gates.find((gate) => gate.id.startsWith('post-click-rsc:'))?.status)
      .toBe('pass');

    const postClickGates = evaluateNavigationPerformance({
      summaries: summarizeNavigationSamples(samples.map((entry, index) => (
        index === 19 ? { ...entry, postClickTargetRscRequests: 1 } : entry
      ))),
      configuredSamples: 20,
      idlePrefetch: idle(),
      policyContracts: [],
    });
    expect(postClickGates.find((gate) => gate.id.startsWith('intent-prefetch:'))?.status)
      .toBe('pass');
    expect(postClickGates.find((gate) => gate.id.startsWith('post-click-rsc:'))?.status)
      .toBe('fail');
  });

  it('rejects incomplete production-shaped intent evidence', () => {
    const valid = Array.from({ length: 20 }, (_, index) => (
      sample({
        sample: index + 1,
        intentTargetRscRequests: 2,
        intentTargetRscSettled: 2,
        intentTargetRscCompleted: index === 0 ? 1 : 0,
        intentTargetRscSized: index === 0 ? 1 : 0,
      })
    ));
    const invalidGroups = [
      valid.map((entry, index) => index === 19 ? {
        ...entry,
        intentTargetRscRequests: 0,
        intentTargetRscSettled: 0,
      } : entry),
      valid.map((entry, index) => index === 19 ? {
        ...entry,
        intentTargetRscSettled: 1,
      } : entry),
      valid.map((entry) => ({
        ...entry,
        intentTargetRscCompleted: 0,
        intentTargetRscSized: 0,
      })),
      valid.map((entry) => ({
        ...entry,
        intentTargetRscSized: 0,
      })),
    ];

    for (const samples of invalidGroups) {
      const summaries = summarizeNavigationSamples(samples);
      const gates = evaluateNavigationPerformance({
        summaries,
        configuredSamples: 20,
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

  it.each([
    ['source_navigation', 'source_navigation_failed'],
    ['source_heading', 'source_heading_unavailable'],
    ['probe_install', 'probe_install_failed'],
    ['link_discovery', 'navigation_link_unavailable'],
    ['intent_activation', 'intent_activation_failed'],
    ['intent_settlement', 'intent_settlement_failed'],
    ['navigation_activation', 'navigation_activation_failed'],
    ['destination_url', 'destination_url_unavailable'],
    ['destination_heading', 'destination_heading_unavailable'],
    ['post_ready_observation', 'post_ready_observation_failed'],
  ] as const)('maps the %s stage to stable reason %s', (stage, reason) => {
    const error = new NavigationSampleMonitorError({
      profile: 'mobile',
      interaction: 'touch',
      transitionId: 'standings-to-live',
      sample: 'warmup',
      stage,
    });

    expect(classifyNavigationMonitorFailure(error).context).toMatchObject({
      sample: 'warmup',
      stage,
      reason,
    });
  });

  it('retains allowlisted sample context without leaking raw diagnostic text', () => {
    const rawDiagnostic = new Error(
      "locator('main h1[data-private=\"player-987\"]') timed out at "
      + 'https://example.test/match/private-id?_rsc=secret&player=987'
      + '\n# markdown-injection\u001b[31m',
    );
    const error = new NavigationSampleMonitorError({
      profile: 'desktop',
      interaction: 'keyboard',
      transitionId: 'live-to-records',
      sample: 'measured-7',
      stage: 'destination_heading',
    });
    error.stack = rawDiagnostic.message;
    (error as Error & { cause?: unknown }).cause = rawDiagnostic;

    const failure = classifyNavigationMonitorFailure(error);
    const report = createNavigationMonitorErrorReport(
      '2026-07-26T00:00:00.000Z',
      '2026-07-26T00:00:01.000Z',
      error,
    );
    const json = JSON.stringify(report);
    const markdown = renderNavigationMonitorErrorMarkdown(report);
    const stderr = `Navigation performance monitor failed (${failure.code}): ${failure.message}`;

    expect(failure).toEqual({
      code: 'navigation_sample_failed',
      message: 'A navigation sample could not be completed.',
      context: {
        profile: 'desktop',
        interaction: 'keyboard',
        transitionId: 'live-to-records',
        sample: 'measured-7',
        stage: 'destination_heading',
        reason: 'destination_heading_unavailable',
      },
    });
    expect(report.context).toEqual(failure.context);
    expect(markdown).toContain('- Sample: `measured-7`');
    expect(markdown).toContain('- Stage: `destination_heading`');
    expect(markdown).toContain(
      '- Failure reason: `destination_heading_unavailable`',
    );
    for (const output of [json, markdown, stderr]) {
      expect(output).not.toContain('https://example.test');
      expect(output).not.toContain('_rsc');
      expect(output).not.toContain('private-id');
      expect(output).not.toContain('player-987');
      expect(output).not.toContain('locator(');
      expect(output).not.toContain('markdown-injection');
      expect(output).not.toContain('\u001b');
    }
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
    expect(markdown).toContain('Intent samples emitted/settled');
    expect(markdown).toContain('Intent RSC req/settled/done/sized');
    expect(markdown).toContain('| desktop | pointer | records-to-rankings |');
    expect(markdown).toContain('| 1/1 | 1/1/1/1 |');
  });
});
