export const NAVIGATION_PERFORMANCE_SCHEMA =
  'centrepass-navigation-performance.v1' as const;

export type NavigationProfile = 'desktop' | 'mobile';
export type NavigationInteraction = 'pointer' | 'touch' | 'keyboard';
export type GateStatus = 'pass' | 'fail' | 'observe';

export interface NavigationPerformanceBudgets {
  routeP95Ms: number;
  acknowledgementP95Ms: number;
  maxIdleRscRequests: number;
  maxIdleRscBytes: number;
  maxUnexpectedRequestFailures: number;
  maxServerErrors: number;
}

export const DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS: NavigationPerformanceBudgets = {
  routeP95Ms: 2_000,
  acknowledgementP95Ms: 150,
  maxIdleRscRequests: 8,
  // Phase 7 completed 14,485 response-body bytes. Keep some transport/build
  // headroom while retaining a meaningful regression boundary.
  maxIdleRscBytes: 20_000,
  maxUnexpectedRequestFailures: 0,
  maxServerErrors: 0,
};

export interface NavigationSample {
  transitionId: string;
  profile: NavigationProfile;
  interaction: NavigationInteraction;
  sample: number;
  sourcePath: string;
  targetPath: string;
  durationMs: number;
  acknowledgementMs: number | null;
  intentPrefetchWaitMs: number;
  intentTargetRscRequests: number;
  intentTargetRscSettled: number;
  postClickTargetRscRequests: number;
  consoleErrors: number;
  ignoredKnownConsoleErrors: number;
  pageErrors: number;
  unexpectedRequestFailures: number;
  benignAbortedRscRequests: number;
  serverErrors: number;
}

export interface NavigationSummary {
  transitionId: string;
  profile: NavigationProfile;
  interaction: NavigationInteraction;
  count: number;
  durationP50Ms: number;
  durationP95Ms: number;
  acknowledgementP50Ms: number;
  acknowledgementP95Ms: number;
  intentTargetRscRequests: number;
  intentTargetRscSettled: number;
  postClickTargetRscRequests: number;
  consoleErrors: number;
  ignoredKnownConsoleErrors: number;
  pageErrors: number;
  unexpectedRequestFailures: number;
  benignAbortedRscRequests: number;
  serverErrors: number;
}

export interface IdlePrefetchMeasurement {
  route: string;
  observedForMs: number;
  emittedRscRequests: number;
  completedRscRequests: number;
  completedRscBytes: number | null;
  benignAbortedRscRequests: number;
  unexpectedRequestFailures: number;
  serverErrors: number;
}

export interface PolicyContractMeasurement {
  id: string;
  profile: NavigationProfile;
  sourcePath: string;
  targetPath: string;
  preClickTargetRscRequests: number;
  observationMs: number;
}

export interface GateResult {
  id: string;
  status: GateStatus;
  message: string;
}

export interface ProductionEndpointEvidence {
  status: number;
  ok: boolean;
  latencyMs: number;
}

export interface NavigationPerformanceReport {
  schema: typeof NAVIGATION_PERFORMANCE_SCHEMA;
  startedAt: string;
  completedAt: string;
  baseUrl: string;
  expectedRelease: string | null;
  observedRelease: string;
  health: ProductionEndpointEvidence;
  readiness: ProductionEndpointEvidence;
  configuredSamples: number;
  budgets: NavigationPerformanceBudgets;
  summaries: NavigationSummary[];
  samples: NavigationSample[];
  idlePrefetch: IdlePrefetchMeasurement;
  policyContracts: PolicyContractMeasurement[];
  gates: GateResult[];
  passed: boolean;
  budgetsEnforced: boolean;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new Error('Percentile must be greater than zero and at most one');
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return rounded(sorted[index] ?? 0);
}

function effectiveAcknowledgement(sample: NavigationSample): number {
  // A route that commits before its pending indicator can paint has already
  // acknowledged the action. Slow routes must surface the pending state.
  return sample.acknowledgementMs ?? sample.durationMs;
}

export function summarizeNavigationSamples(
  samples: readonly NavigationSample[],
): NavigationSummary[] {
  const groups = new Map<string, NavigationSample[]>();
  for (const sample of samples) {
    const key = [sample.transitionId, sample.profile, sample.interaction].join(':');
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const first = group[0];
      if (!first) throw new Error('Navigation sample group is unexpectedly empty');
      return {
        transitionId: first.transitionId,
        profile: first.profile,
        interaction: first.interaction,
        count: group.length,
        durationP50Ms: nearestRank(group.map((sample) => sample.durationMs), 0.5),
        durationP95Ms: nearestRank(group.map((sample) => sample.durationMs), 0.95),
        acknowledgementP50Ms: nearestRank(
          group.map(effectiveAcknowledgement),
          0.5,
        ),
        acknowledgementP95Ms: nearestRank(
          group.map(effectiveAcknowledgement),
          0.95,
        ),
        intentTargetRscRequests: group.reduce(
          (total, sample) => total + sample.intentTargetRscRequests,
          0,
        ),
        intentTargetRscSettled: group.reduce(
          (total, sample) => total + sample.intentTargetRscSettled,
          0,
        ),
        postClickTargetRscRequests: group.reduce(
          (total, sample) => total + sample.postClickTargetRscRequests,
          0,
        ),
        consoleErrors: group.reduce(
          (total, sample) => total + sample.consoleErrors,
          0,
        ),
        ignoredKnownConsoleErrors: group.reduce(
          (total, sample) => total + sample.ignoredKnownConsoleErrors,
          0,
        ),
        pageErrors: group.reduce(
          (total, sample) => total + sample.pageErrors,
          0,
        ),
        unexpectedRequestFailures: group.reduce(
          (total, sample) => total + sample.unexpectedRequestFailures,
          0,
        ),
        benignAbortedRscRequests: group.reduce(
          (total, sample) => total + sample.benignAbortedRscRequests,
          0,
        ),
        serverErrors: group.reduce(
          (total, sample) => total + sample.serverErrors,
          0,
        ),
      };
    })
    .sort((left, right) => (
      left.profile.localeCompare(right.profile)
      || left.transitionId.localeCompare(right.transitionId)
      || left.interaction.localeCompare(right.interaction)
    ));
}

interface GateInput {
  summaries: readonly NavigationSummary[];
  configuredSamples: number;
  idlePrefetch: IdlePrefetchMeasurement;
  policyContracts: readonly PolicyContractMeasurement[];
  budgets?: NavigationPerformanceBudgets;
}

export function evaluateNavigationPerformance({
  summaries,
  configuredSamples,
  idlePrefetch,
  policyContracts,
  budgets = DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
}: GateInput): GateResult[] {
  const gates: GateResult[] = [];

  for (const summary of summaries) {
    const label = `${summary.profile}/${summary.interaction}/${summary.transitionId}`;
    gates.push({
      id: `samples:${label}`,
      status: summary.count >= configuredSamples ? 'pass' : 'fail',
      message: `${label} captured ${summary.count}/${configuredSamples} required samples`,
    });
    gates.push({
      id: `route-p95:${label}`,
      status: summary.durationP95Ms <= budgets.routeP95Ms ? 'pass' : 'fail',
      message: `${label} route p95 ${summary.durationP95Ms}ms (budget ${budgets.routeP95Ms}ms)`,
    });
    gates.push({
      id: `acknowledgement-p95:${label}`,
      status: summary.acknowledgementP95Ms <= budgets.acknowledgementP95Ms
        ? 'pass'
        : 'fail',
      message: `${label} acknowledgement p95 ${summary.acknowledgementP95Ms}ms (budget ${budgets.acknowledgementP95Ms}ms)`,
    });

    const runtimeErrors = summary.consoleErrors + summary.pageErrors;
    gates.push({
      id: `runtime-errors:${label}`,
      status: runtimeErrors === 0 ? 'pass' : 'fail',
      message: `${label} recorded ${runtimeErrors} browser runtime error(s)`,
    });
    gates.push({
      id: `network-errors:${label}`,
      status: (
        summary.unexpectedRequestFailures <= budgets.maxUnexpectedRequestFailures
        && summary.serverErrors <= budgets.maxServerErrors
      ) ? 'pass' : 'fail',
      message: `${label} recorded ${summary.unexpectedRequestFailures} unexpected request failure(s) and ${summary.serverErrors} HTTP 5xx response(s)`,
    });

    const shouldRequireConsumedIntentPrefetch = (
      summary.profile === 'desktop'
      && ['pointer', 'keyboard'].includes(summary.interaction)
      && ['records-to-rankings', 'live-to-records'].includes(summary.transitionId)
    );
    if (shouldRequireConsumedIntentPrefetch) {
      gates.push({
        id: `post-click-rsc:${label}`,
        status: summary.postClickTargetRscRequests === 0 ? 'pass' : 'fail',
        message: `${label} emitted ${summary.postClickTargetRscRequests} target RSC request(s) after click`,
      });
    }
  }

  gates.push({
    id: 'idle-prefetch-requests',
    status: idlePrefetch.emittedRscRequests <= budgets.maxIdleRscRequests
      ? 'pass'
      : 'fail',
    message: `${idlePrefetch.route} emitted ${idlePrefetch.emittedRscRequests} idle RSC request(s) (budget ${budgets.maxIdleRscRequests})`,
  });
  gates.push({
    id: 'idle-prefetch-bytes',
    status: idlePrefetch.completedRscBytes === null
      ? 'observe'
      : idlePrefetch.completedRscBytes <= budgets.maxIdleRscBytes
        ? 'pass'
        : 'fail',
    message: idlePrefetch.completedRscBytes === null
      ? `${idlePrefetch.route} response-body byte sizes were unavailable`
      : `${idlePrefetch.route} completed ${idlePrefetch.completedRscBytes} idle RSC response-body bytes (budget ${budgets.maxIdleRscBytes})`,
  });
  gates.push({
    id: 'idle-prefetch-network-errors',
    status: (
      idlePrefetch.unexpectedRequestFailures <= budgets.maxUnexpectedRequestFailures
      && idlePrefetch.serverErrors <= budgets.maxServerErrors
    ) ? 'pass' : 'fail',
    message: `${idlePrefetch.route} recorded ${idlePrefetch.unexpectedRequestFailures} unexpected request failure(s) and ${idlePrefetch.serverErrors} HTTP 5xx response(s)`,
  });

  for (const contract of policyContracts) {
    gates.push({
      id: `policy:${contract.id}`,
      status: contract.preClickTargetRscRequests === 0 ? 'pass' : 'fail',
      message: `${contract.id} emitted ${contract.preClickTargetRscRequests} target RSC request(s) before click during ${contract.observationMs}ms observation`,
    });
  }

  return gates;
}

function gateIcon(status: GateStatus): string {
  if (status === 'pass') return 'PASS';
  if (status === 'fail') return 'FAIL';
  return 'OBSERVE';
}

export function renderNavigationPerformanceMarkdown(
  report: NavigationPerformanceReport,
): string {
  const lines = [
    '# CentrePass navigation performance',
    '',
    `- Result: **${report.passed ? 'PASS' : 'FAIL'}${report.budgetsEnforced ? '' : ' (report-only budgets)'}**`,
    `- Release: \`${report.observedRelease}\``,
    `- Expected release: ${report.expectedRelease ? `\`${report.expectedRelease}\`` : 'not supplied'}`,
    `- Window: ${report.startedAt} to ${report.completedAt}`,
    `- Health: ${report.health.ok ? 'ready' : 'failed'} (${report.health.latencyMs}ms)`,
    `- Readiness: ${report.readiness.ok ? 'ready' : 'failed'} (${report.readiness.latencyMs}ms)`,
    '',
    '## Navigation samples',
    '',
    '| Profile | Interaction | Transition | Samples | Route p50 | Route p95 | Ack p95 | Post-click target RSC | Runtime/network errors | Known CSP noise |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const summary of report.summaries) {
    const errors = (
      summary.consoleErrors
      + summary.pageErrors
      + summary.unexpectedRequestFailures
      + summary.serverErrors
    );
    lines.push(
      `| ${summary.profile} | ${summary.interaction} | ${summary.transitionId} | ${summary.count} | ${summary.durationP50Ms}ms | ${summary.durationP95Ms}ms | ${summary.acknowledgementP95Ms}ms | ${summary.postClickTargetRscRequests} | ${errors} | ${summary.ignoredKnownConsoleErrors} |`,
    );
  }

  lines.push(
    '',
    '## Idle prefetch',
    '',
    `- Route: \`${report.idlePrefetch.route}\``,
    `- Emitted/completed RSC requests: ${report.idlePrefetch.emittedRscRequests}/${report.idlePrefetch.completedRscRequests}`,
    `- Completed response-body bytes: ${report.idlePrefetch.completedRscBytes ?? 'unavailable'}`,
    `- Benign aborted RSC requests: ${report.idlePrefetch.benignAbortedRscRequests}`,
    '',
    '## Gates',
    '',
  );

  for (const gate of report.gates) {
    lines.push(`- **${gateIcon(gate.status)}** — ${gate.message}`);
  }

  lines.push(
    '',
    'Budget misses are evidence-only until enforcement is explicitly enabled.',
    '',
  );
  return lines.join('\n');
}
