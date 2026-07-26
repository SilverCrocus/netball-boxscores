import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance as nodePerformance } from 'node:perf_hooks';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from 'playwright';
import {
  DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
  NAVIGATION_PERFORMANCE_SCHEMA,
  evaluateNavigationPerformance,
  renderNavigationPerformanceMarkdown,
  summarizeNavigationSamples,
  type IdlePrefetchMeasurement,
  type NavigationInteraction,
  type NavigationPerformanceReport,
  type NavigationProfile,
  type NavigationSample,
  type PolicyContractMeasurement,
  type ProductionEndpointEvidence,
} from '@/lib/navigation-performance-monitor';

const DEFAULT_BASE_URL = 'https://www.centrepass.io';
const DEFAULT_OUTPUT_DIRECTORY = '.artifacts/performance-regression';
const DEFAULT_SAMPLES = 20;
const MAX_SAMPLES = 50;
const PAGE_TIMEOUT_MS = 45_000;
const INTENT_PREFETCH_TIMEOUT_MS = 5_000;
const INTENT_NO_REQUEST_GRACE_MS = 500;
const IDLE_OBSERVATION_MS = 3_000;
const POLICY_OBSERVATION_MS = 750;
const MAX_ENDPOINT_BODY_BYTES = 1_000_000;

type LogicalDestination = 'live' | 'standings' | 'rankings' | 'records';
type NetworkPhase = 'source' | 'intent' | 'post-click' | 'idle' | 'done';

interface TransitionDefinition {
  id: string;
  sourcePath: string;
  sourceDestination: LogicalDestination;
  targetDestination: LogicalDestination;
}

interface MonitorConfiguration {
  baseUrl: URL;
  expectedRelease: string | null;
  samples: number;
  enforceBudgets: boolean;
  outputDirectory: string;
}

interface EndpointResult {
  evidence: ProductionEndpointEvidence;
  body: unknown;
}

interface PageCounters {
  consoleErrors: number;
  pageErrors: number;
  unexpectedRequestFailures: number;
  benignAbortedRscRequests: number;
  serverErrors: number;
  intentTargetRscRequests: number;
  intentTargetRscSettled: number;
  postClickTargetRscRequests: number;
  ignoredKnownConsoleErrors: number;
  emittedRscRequests: number;
  completedRscRequests: number;
  completedRscBytes: number;
  completedRscBytesAvailable: boolean;
}

interface PageObserver {
  counters: PageCounters;
  setPhase: (phase: NetworkPhase) => void;
  flush: () => Promise<void>;
}

interface ProbeWindow extends Window {
  __centrepassPerformanceProbe?: {
    startedAt: number | null;
    acknowledgementMs: number | null;
    observer: MutationObserver;
  };
}

function argumentValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`Expected a boolean value, received ${value}`);
}

function parseSampleCount(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_SAMPLES;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_SAMPLES) {
    throw new Error(`Samples must be an integer between 1 and ${MAX_SAMPLES}`);
  }
  return parsed;
}

function parseBaseUrl(value: string | undefined): URL {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Performance base URL must use HTTP or HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Performance base URL must not contain credentials, a query, or a fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url;
}

function readConfiguration(): MonitorConfiguration {
  return {
    baseUrl: parseBaseUrl(
      argumentValue('base-url') ?? process.env.PERF_BASE_URL,
    ),
    expectedRelease: (
      argumentValue('expected-release')
      ?? process.env.PERF_EXPECTED_RELEASE_SHA
      ?? ''
    ).trim() || null,
    samples: parseSampleCount(
      argumentValue('samples') ?? process.env.PERF_SAMPLES,
    ),
    enforceBudgets: parseBoolean(
      argumentValue('enforce-budgets') ?? process.env.PERF_ENFORCE_BUDGETS,
    ),
    outputDirectory: path.resolve(
      argumentValue('output')
      ?? process.env.PERF_OUTPUT_DIRECTORY
      ?? DEFAULT_OUTPUT_DIRECTORY,
    ),
  };
}

function isLogicalDestination(
  pathname: string,
  destination: LogicalDestination,
): boolean {
  if (destination === 'standings') {
    return pathname === '/standings' || pathname.endsWith('/standings');
  }
  if (destination === 'live') {
    return pathname === '/live' || /^\/match\/[^/]+$/.test(pathname);
  }
  return pathname === `/${destination}`;
}

function isRscRequest(request: Request): boolean {
  try {
    return new URL(request.url()).searchParams.has('_rsc');
  } catch {
    return false;
  }
}

function isSameOriginRequest(request: Request, baseUrl: URL): boolean {
  try {
    return new URL(request.url()).origin === baseUrl.origin;
  } catch {
    return false;
  }
}

function isTargetRscRequest(
  request: Request,
  baseUrl: URL,
  destination: LogicalDestination,
): boolean {
  if (!isRscRequest(request) || !isSameOriginRequest(request, baseUrl)) return false;
  return isLogicalDestination(new URL(request.url()).pathname, destination);
}

function isKnownAnalyticsCspNoise(message: string): boolean {
  return (
    message.startsWith(
      "Loading the script 'https://www.googletagmanager.com/gtag/js?id=",
    )
    && message.includes(
      'violates the following Content Security Policy directive',
    )
  );
}

function createPageObserver(
  page: Page,
  baseUrl: URL,
  targetDestination: LogicalDestination | null,
): PageObserver {
  let phase: NetworkPhase = 'source';
  const requestPhases = new WeakMap<Request, NetworkPhase>();
  const pending: Promise<void>[] = [];
  const counters: PageCounters = {
    consoleErrors: 0,
    pageErrors: 0,
    unexpectedRequestFailures: 0,
    benignAbortedRscRequests: 0,
    serverErrors: 0,
    intentTargetRscRequests: 0,
    intentTargetRscSettled: 0,
    postClickTargetRscRequests: 0,
    ignoredKnownConsoleErrors: 0,
    emittedRscRequests: 0,
    completedRscRequests: 0,
    completedRscBytes: 0,
    completedRscBytesAvailable: true,
  };

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (isKnownAnalyticsCspNoise(message.text())) {
      counters.ignoredKnownConsoleErrors += 1;
      return;
    }
    counters.consoleErrors += 1;
  });
  page.on('pageerror', () => {
    counters.pageErrors += 1;
  });
  page.on('request', (request) => {
    if (!isSameOriginRequest(request, baseUrl)) return;
    requestPhases.set(request, phase);
    if (isRscRequest(request)) counters.emittedRscRequests += 1;
    if (
      targetDestination
      && isTargetRscRequest(request, baseUrl, targetDestination)
    ) {
      if (phase === 'intent') counters.intentTargetRscRequests += 1;
      if (phase === 'post-click') counters.postClickTargetRscRequests += 1;
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (
      isSameOriginRequest(request, baseUrl)
      && response.status() >= 500
    ) {
      counters.serverErrors += 1;
    }
  });
  page.on('requestfailed', (request) => {
    if (!isSameOriginRequest(request, baseUrl)) return;
    const requestPhase = requestPhases.get(request);
    if (
      requestPhase === 'intent'
      && targetDestination
      && isTargetRscRequest(request, baseUrl, targetDestination)
    ) {
      counters.intentTargetRscSettled += 1;
    }
    const failure = request.failure()?.errorText ?? '';
    if (isRscRequest(request) && failure.includes('ERR_ABORTED')) {
      counters.benignAbortedRscRequests += 1;
      return;
    }
    counters.unexpectedRequestFailures += 1;
  });
  page.on('requestfinished', (request) => {
    if (!isSameOriginRequest(request, baseUrl)) return;
    const requestPhase = requestPhases.get(request);
    if (isRscRequest(request)) {
      counters.completedRscRequests += 1;
      if (
        requestPhase === 'intent'
        && targetDestination
        && isTargetRscRequest(request, baseUrl, targetDestination)
      ) {
        counters.intentTargetRscSettled += 1;
      }
      const sizePromise = request.sizes()
        .then((sizes) => {
          counters.completedRscBytes += Math.max(0, sizes.responseBodySize);
        })
        .catch(() => {
          counters.completedRscBytesAvailable = false;
        });
      pending.push(sizePromise);
    }
  });

  return {
    counters,
    setPhase(nextPhase) {
      phase = nextPhase;
    },
    async flush() {
      await Promise.allSettled(pending);
    },
  };
}

async function fetchJson(
  baseUrl: URL,
  pathname: string,
): Promise<EndpointResult> {
  const url = new URL(pathname, baseUrl);
  const startedAt = nodePerformance.now();
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const latencyMs = Math.round((nodePerformance.now() - startedAt) * 10) / 10;
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAX_ENDPOINT_BODY_BYTES
  ) {
    throw new Error(`${pathname} response exceeded the bounded evidence size`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_ENDPOINT_BODY_BYTES) {
    throw new Error(`${pathname} response exceeded the bounded evidence size`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${pathname} did not return JSON`);
  }
  return {
    evidence: {
      status: response.status,
      ok: response.ok,
      latencyMs,
    },
    body,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

async function verifyProductionPrerequisites(
  configuration: MonitorConfiguration,
): Promise<{
  health: ProductionEndpointEvidence;
  readiness: ProductionEndpointEvidence;
  observedRelease: string;
}> {
  const healthResult = await fetchJson(configuration.baseUrl, '/api/health');
  const readinessResult = await fetchJson(configuration.baseUrl, '/api/readiness');
  const healthBody = objectValue(healthResult.body);
  const readinessBody = objectValue(readinessResult.body);
  const release = objectValue(healthBody.release);
  const observedRelease = typeof release.commit === 'string'
    ? release.commit
    : '';

  healthResult.evidence.ok = (
    healthResult.evidence.ok
    && healthBody.status === 'ok'
    && observedRelease.length > 0
  );
  readinessResult.evidence.ok = (
    readinessResult.evidence.ok
    && readinessBody.status === 'ready'
  );

  if (!healthResult.evidence.ok) {
    throw new Error('Production health prerequisite failed');
  }
  if (!readinessResult.evidence.ok) {
    throw new Error('Production readiness prerequisite failed');
  }
  if (
    configuration.expectedRelease
    && observedRelease !== configuration.expectedRelease
  ) {
    throw new Error(
      `Production release mismatch: expected ${configuration.expectedRelease}, observed ${observedRelease}`,
    );
  }

  return {
    health: healthResult.evidence,
    readiness: readinessResult.evidence,
    observedRelease,
  };
}

function contextOptions(profile: NavigationProfile) {
  if (profile === 'mobile') {
    return {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      serviceWorkers: 'block' as const,
      reducedMotion: 'reduce' as const,
    };
  }
  return {
    viewport: { width: 1_440, height: 900 },
    hasTouch: false,
    isMobile: false,
    serviceWorkers: 'block' as const,
    reducedMotion: 'reduce' as const,
  };
}

async function waitForHeading(page: Page): Promise<void> {
  const heading = page.locator('main h1:visible').first();
  await heading.waitFor({ state: 'visible', timeout: PAGE_TIMEOUT_MS });
  const text = (await heading.textContent())?.trim();
  if (!text) throw new Error('Page rendered without a meaningful main heading');
}

async function gotoSource(
  page: Page,
  baseUrl: URL,
  sourcePath: string,
  sourceDestination: LogicalDestination,
): Promise<void> {
  const response = await page.goto(new URL(sourcePath, baseUrl).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: PAGE_TIMEOUT_MS,
  });
  if (!response || response.status() >= 400) {
    throw new Error(`Source route ${sourcePath} returned ${response?.status() ?? 'no response'}`);
  }
  const current = new URL(page.url());
  if (!isLogicalDestination(current.pathname, sourceDestination)) {
    throw new Error(`Source route ${sourcePath} resolved to an unexpected path`);
  }
  await waitForHeading(page);
}

async function findVisibleNavigationLink(
  page: Page,
  baseUrl: URL,
  destination: LogicalDestination,
) {
  const startedAt = nodePerformance.now();
  while (nodePerformance.now() - startedAt < PAGE_TIMEOUT_MS) {
    const links = page.locator('a:visible');
    const count = await links.count();
    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      const href = await link.getAttribute('href');
      if (!href) continue;
      const resolved = new URL(href, page.url());
      if (
        resolved.origin === baseUrl.origin
        && isLogicalDestination(resolved.pathname, destination)
      ) {
        return link;
      }
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`No visible navigation link found for ${destination}`);
}

async function discoverCanonicalStandingsPath(
  browser: Browser,
  baseUrl: URL,
): Promise<string> {
  const context = await browser.newContext(contextOptions('desktop'));
  const page = await context.newPage();
  try {
    await gotoSource(page, baseUrl, '/rankings', 'rankings');
    const link = await findVisibleNavigationLink(page, baseUrl, 'standings');
    const href = await link.getAttribute('href');
    if (!href) throw new Error('Standings link has no destination');
    const resolved = new URL(href, page.url());
    if (resolved.origin !== baseUrl.origin) {
      throw new Error('Standings link unexpectedly crosses origins');
    }
    return `${resolved.pathname}${resolved.search}`;
  } finally {
    await context.close();
  }
}

async function installAcknowledgementProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as ProbeWindow;
    probeWindow.__centrepassPerformanceProbe?.observer.disconnect();
    const state = {
      startedAt: null as number | null,
      acknowledgementMs: null as number | null,
      observer: new MutationObserver(() => {
        if (state.startedAt === null || state.acknowledgementMs !== null) return;
        const pending = document.querySelector(
          '[data-navigation-pending="true"]',
        );
        if (pending) {
          state.acknowledgementMs = performance.now() - state.startedAt;
        }
      }),
    };
    state.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-navigation-pending'],
      subtree: true,
    });
    probeWindow.__centrepassPerformanceProbe = state;
  });
}

async function startAcknowledgementProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as ProbeWindow).__centrepassPerformanceProbe;
    if (!state) throw new Error('Acknowledgement probe is not installed');
    state.startedAt = performance.now();
    state.acknowledgementMs = null;
  });
}

async function readNavigationTimings(
  page: Page,
  fallbackDurationMs: number,
): Promise<{
  durationMs: number;
  acknowledgementMs: number | null;
}> {
  try {
    return await page.evaluate(() => {
      const state = (window as ProbeWindow).__centrepassPerformanceProbe;
      if (!state || state.startedAt === null) {
        throw new Error('Acknowledgement probe did not survive navigation');
      }
      const durationMs = performance.now() - state.startedAt;
      return {
        durationMs: Math.round(durationMs * 10) / 10,
        acknowledgementMs: state.acknowledgementMs === null
          ? null
          : Math.round(state.acknowledgementMs * 10) / 10,
      };
    });
  } catch {
    // A full-document transition replaces the source window. Preserve a
    // monotonic click-to-ready measurement and let the acknowledgement gate
    // treat the completed navigation itself as the first acknowledgement.
    return {
      durationMs: Math.round(fallbackDurationMs * 10) / 10,
      acknowledgementMs: null,
    };
  }
}

async function waitForIntentPrefetch(observer: PageObserver): Promise<number> {
  const startedAt = nodePerformance.now();
  while (nodePerformance.now() - startedAt < INTENT_PREFETCH_TIMEOUT_MS) {
    if (
      observer.counters.intentTargetRscRequests > 0
      && observer.counters.intentTargetRscSettled
        >= observer.counters.intentTargetRscRequests
    ) {
      break;
    }
    if (
      observer.counters.intentTargetRscRequests === 0
      && nodePerformance.now() - startedAt >= INTENT_NO_REQUEST_GRACE_MS
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await observer.flush();
  return Math.round((nodePerformance.now() - startedAt) * 10) / 10;
}

async function waitForDestination(
  page: Page,
  destination: LogicalDestination,
): Promise<void> {
  await page.waitForURL(
    (url) => isLogicalDestination(url.pathname, destination),
    { timeout: PAGE_TIMEOUT_MS },
  );
  await waitForHeading(page);
}

async function performInteraction(
  page: Page,
  baseUrl: URL,
  interaction: NavigationInteraction,
  observer: PageObserver,
  destination: LogicalDestination,
): Promise<{
  intentPrefetchWaitMs: number;
  navigationStartedAt: number;
}> {
  const link = await findVisibleNavigationLink(
    page,
    baseUrl,
    destination,
  );
  let intentPrefetchWaitMs = 0;
  let navigationStartedAt = 0;

  if (interaction === 'pointer') {
    observer.setPhase('intent');
    await link.hover({ timeout: PAGE_TIMEOUT_MS });
    intentPrefetchWaitMs = await waitForIntentPrefetch(observer);
    await startAcknowledgementProbe(page);
    navigationStartedAt = nodePerformance.now();
    observer.setPhase('post-click');
    await link.click({ timeout: PAGE_TIMEOUT_MS });
  } else if (interaction === 'keyboard') {
    observer.setPhase('intent');
    await link.focus();
    intentPrefetchWaitMs = await waitForIntentPrefetch(observer);
    await startAcknowledgementProbe(page);
    navigationStartedAt = nodePerformance.now();
    observer.setPhase('post-click');
    await link.press('Enter', { timeout: PAGE_TIMEOUT_MS });
  } else {
    await startAcknowledgementProbe(page);
    navigationStartedAt = nodePerformance.now();
    observer.setPhase('post-click');
    await link.tap({ timeout: PAGE_TIMEOUT_MS });
  }

  await waitForDestination(page, destination);
  observer.setPhase('done');
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { intentPrefetchWaitMs, navigationStartedAt };
}

async function runNavigationSample(
  context: BrowserContext,
  baseUrl: URL,
  transition: TransitionDefinition,
  profile: NavigationProfile,
  interaction: NavigationInteraction,
  sampleNumber: number,
): Promise<NavigationSample> {
  const page = await context.newPage();
  const observer = createPageObserver(page, baseUrl, transition.targetDestination);
  try {
    await gotoSource(
      page,
      baseUrl,
      transition.sourcePath,
      transition.sourceDestination,
    );
    await installAcknowledgementProbe(page);
    const interactionResult = await performInteraction(
      page,
      baseUrl,
      interaction,
      observer,
      transition.targetDestination,
    );
    const fallbackDurationMs = (
      nodePerformance.now() - interactionResult.navigationStartedAt
    );
    const timings = await readNavigationTimings(page, fallbackDurationMs);
    await observer.flush();

    return {
      transitionId: transition.id,
      profile,
      interaction,
      sample: sampleNumber,
      sourcePath: transition.sourcePath.split('?')[0] ?? transition.sourcePath,
      targetPath: `/${transition.targetDestination}`,
      durationMs: timings.durationMs,
      acknowledgementMs: timings.acknowledgementMs,
      intentPrefetchWaitMs: interactionResult.intentPrefetchWaitMs,
      intentTargetRscRequests: observer.counters.intentTargetRscRequests,
      intentTargetRscSettled: observer.counters.intentTargetRscSettled,
      postClickTargetRscRequests: observer.counters.postClickTargetRscRequests,
      consoleErrors: observer.counters.consoleErrors,
      ignoredKnownConsoleErrors: observer.counters.ignoredKnownConsoleErrors,
      pageErrors: observer.counters.pageErrors,
      unexpectedRequestFailures: observer.counters.unexpectedRequestFailures,
      benignAbortedRscRequests: observer.counters.benignAbortedRscRequests,
      serverErrors: observer.counters.serverErrors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown sample failure';
    throw new Error(
      `${profile}/${interaction}/${transition.id} sample ${sampleNumber}: ${message}`,
    );
  } finally {
    await page.close();
  }
}

async function measureTransitionMatrix(
  browser: Browser,
  baseUrl: URL,
  transitions: readonly TransitionDefinition[],
  samplesPerTransition: number,
): Promise<NavigationSample[]> {
  const samples: NavigationSample[] = [];
  for (const profile of ['desktop', 'mobile'] as const) {
    const context = await browser.newContext(contextOptions(profile));
    const interaction: NavigationInteraction = profile === 'desktop'
      ? 'pointer'
      : 'touch';
    try {
      for (const transition of transitions) {
        // One excluded warmup preserves a comparable browser/cache state without
        // presenting the monitor as a load test.
        await runNavigationSample(
          context,
          baseUrl,
          transition,
          profile,
          interaction,
          0,
        );
        for (let sampleNumber = 1; sampleNumber <= samplesPerTransition; sampleNumber += 1) {
          samples.push(await runNavigationSample(
            context,
            baseUrl,
            transition,
            profile,
            interaction,
            sampleNumber,
          ));
        }
      }
    } finally {
      await context.close();
    }
  }

  const keyboardContext = await browser.newContext(contextOptions('desktop'));
  try {
    for (const transition of transitions.filter(({ id }) => (
      id === 'records-to-rankings' || id === 'live-to-records'
    ))) {
      await runNavigationSample(
        keyboardContext,
        baseUrl,
        transition,
        'desktop',
        'keyboard',
        0,
      );
      for (let sampleNumber = 1; sampleNumber <= samplesPerTransition; sampleNumber += 1) {
        samples.push(await runNavigationSample(
          keyboardContext,
          baseUrl,
          transition,
          'desktop',
          'keyboard',
          sampleNumber,
        ));
      }
    }
  } finally {
    await keyboardContext.close();
  }
  return samples;
}

async function measureIdlePrefetch(
  browser: Browser,
  baseUrl: URL,
): Promise<IdlePrefetchMeasurement> {
  const context = await browser.newContext(contextOptions('desktop'));
  const page = await context.newPage();
  const observer = createPageObserver(page, baseUrl, null);
  observer.setPhase('idle');
  try {
    await gotoSource(page, baseUrl, '/records', 'records');
    await new Promise((resolve) => setTimeout(resolve, IDLE_OBSERVATION_MS));
    observer.setPhase('done');
    await observer.flush();
    return {
      route: '/records',
      observedForMs: IDLE_OBSERVATION_MS,
      emittedRscRequests: observer.counters.emittedRscRequests,
      completedRscRequests: observer.counters.completedRscRequests,
      completedRscBytes: observer.counters.completedRscBytesAvailable
        ? observer.counters.completedRscBytes
        : null,
      benignAbortedRscRequests: observer.counters.benignAbortedRscRequests,
      unexpectedRequestFailures: observer.counters.unexpectedRequestFailures,
      serverErrors: observer.counters.serverErrors,
    };
  } finally {
    await context.close();
  }
}

async function measureConstrainedPolicyContract(
  browser: Browser,
  baseUrl: URL,
  input: {
    id: string;
    sourcePath: string;
    sourceDestination: LogicalDestination;
    targetDestination: LogicalDestination;
    saveData: boolean;
    effectiveType: string;
  },
): Promise<PolicyContractMeasurement> {
  const context = await browser.newContext(contextOptions('desktop'));
  await context.addInitScript(({ saveData, effectiveType }) => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData, effectiveType },
    });
  }, {
    saveData: input.saveData,
    effectiveType: input.effectiveType,
  });
  const page = await context.newPage();
  const observer = createPageObserver(page, baseUrl, input.targetDestination);
  try {
    await gotoSource(
      page,
      baseUrl,
      input.sourcePath,
      input.sourceDestination,
    );
    const link = await findVisibleNavigationLink(
      page,
      baseUrl,
      input.targetDestination,
    );
    observer.setPhase('intent');
    await link.hover({ timeout: PAGE_TIMEOUT_MS });
    await new Promise((resolve) => setTimeout(resolve, POLICY_OBSERVATION_MS));
    observer.setPhase('done');
    await observer.flush();
    return {
      id: input.id,
      profile: 'desktop',
      sourcePath: input.sourcePath,
      targetPath: `/${input.targetDestination}`,
      preClickTargetRscRequests: observer.counters.intentTargetRscRequests,
      observationMs: POLICY_OBSERVATION_MS,
    };
  } finally {
    await context.close();
  }
}

async function measurePolicyContracts(
  browser: Browser,
  baseUrl: URL,
): Promise<PolicyContractMeasurement[]> {
  return [
    await measureConstrainedPolicyContract(browser, baseUrl, {
      id: 'save-data-records-to-rankings',
      sourcePath: '/records',
      sourceDestination: 'records',
      targetDestination: 'rankings',
      saveData: true,
      effectiveType: '4g',
    }),
    await measureConstrainedPolicyContract(browser, baseUrl, {
      id: '2g-live-to-records',
      sourcePath: '/live',
      sourceDestination: 'live',
      targetDestination: 'records',
      saveData: false,
      effectiveType: '2g',
    }),
  ];
}

async function writeReport(
  configuration: MonitorConfiguration,
  report: NavigationPerformanceReport,
): Promise<void> {
  await mkdir(configuration.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(configuration.outputDirectory, 'navigation-performance.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      path.join(configuration.outputDirectory, 'navigation-performance.md'),
      renderNavigationPerformanceMarkdown(report),
      'utf8',
    ),
  ]);
}

async function writeMonitorError(
  configuration: MonitorConfiguration | null,
  startedAt: string,
  error: unknown,
): Promise<void> {
  const outputDirectory = configuration?.outputDirectory
    ?? path.resolve(DEFAULT_OUTPUT_DIRECTORY);
  await mkdir(outputDirectory, { recursive: true });
  const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown monitor error';
  const payload = {
    schema: NAVIGATION_PERFORMANCE_SCHEMA,
    status: 'error',
    startedAt,
    completedAt: new Date().toISOString(),
    message,
  };
  await Promise.all([
    writeFile(
      path.join(outputDirectory, 'navigation-performance-error.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'navigation-performance-error.md'),
      `# CentrePass navigation performance\n\n**MONITOR ERROR** — ${message}\n`,
      'utf8',
    ),
  ]);
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  let configuration: MonitorConfiguration | null = null;
  let browser: Browser | null = null;

  try {
    configuration = readConfiguration();
    const prerequisites = await verifyProductionPrerequisites(configuration);
    browser = await chromium.launch({ headless: true });
    const canonicalStandingsPath = await discoverCanonicalStandingsPath(
      browser,
      configuration.baseUrl,
    );
    const transitions: TransitionDefinition[] = [
      {
        id: 'records-to-rankings',
        sourcePath: '/records',
        sourceDestination: 'records',
        targetDestination: 'rankings',
      },
      {
        id: 'rankings-to-standings',
        sourcePath: '/rankings',
        sourceDestination: 'rankings',
        targetDestination: 'standings',
      },
      {
        id: 'standings-to-live',
        sourcePath: canonicalStandingsPath,
        sourceDestination: 'standings',
        targetDestination: 'live',
      },
      {
        id: 'live-to-records',
        sourcePath: '/live',
        sourceDestination: 'live',
        targetDestination: 'records',
      },
    ];

    const idlePrefetch = await measureIdlePrefetch(
      browser,
      configuration.baseUrl,
    );
    const policyContracts = await measurePolicyContracts(
      browser,
      configuration.baseUrl,
    );
    const samples = await measureTransitionMatrix(
      browser,
      configuration.baseUrl,
      transitions,
      configuration.samples,
    );
    const summaries = summarizeNavigationSamples(samples);
    const gates = evaluateNavigationPerformance({
      summaries,
      configuredSamples: configuration.samples,
      idlePrefetch,
      policyContracts,
      budgets: DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
    });
    const passed = gates.every((gate) => gate.status !== 'fail');
    const report: NavigationPerformanceReport = {
      schema: NAVIGATION_PERFORMANCE_SCHEMA,
      startedAt,
      completedAt: new Date().toISOString(),
      baseUrl: configuration.baseUrl.origin,
      expectedRelease: configuration.expectedRelease,
      observedRelease: prerequisites.observedRelease,
      health: prerequisites.health,
      readiness: prerequisites.readiness,
      configuredSamples: configuration.samples,
      budgets: DEFAULT_NAVIGATION_PERFORMANCE_BUDGETS,
      summaries,
      samples,
      idlePrefetch,
      policyContracts,
      gates,
      passed,
      budgetsEnforced: configuration.enforceBudgets,
    };
    await writeReport(configuration, report);
    process.stdout.write(renderNavigationPerformanceMarkdown(report));
    if (!passed && configuration.enforceBudgets) process.exitCode = 2;
  } catch (error) {
    await writeMonitorError(configuration, startedAt, error);
    throw error;
  } finally {
    await browser?.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown monitor error';
  process.stderr.write(`Navigation performance monitor failed: ${message}\n`);
  process.exitCode = 1;
});
