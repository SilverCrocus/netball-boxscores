interface ActiveNavigation {
  route: string;
  navigationType: 'push' | 'replace' | 'traverse';
  startedAt: number;
  startMark: string;
}

let sequence = 0;
let activeNavigation: ActiveNavigation | null = null;

function safeRoute(url: string): string {
  try {
    return new URL(url, globalThis.location?.origin ?? 'http://localhost').pathname;
  } catch {
    return url.split('?')[0]?.slice(0, 200) ?? '/';
  }
}

function roundDuration(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Starts a navigation mark when the browser Performance API is available. */
export function markClientNavigationStart(
  url: string,
  navigationType: ActiveNavigation['navigationType'],
): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;

  const route = safeRoute(url);
  const startMark = `centrepass-navigation-start-${sequence++}`;
  try {
    performance.mark(startMark);
    activeNavigation = {
      route,
      navigationType,
      startedAt: performance.now(),
      startMark,
    };
  } catch {
    // Instrumentation must never affect navigation.
  }
}

/** Completes the active mark after the App Router commits the new route. */
export function markClientNavigationComplete(pathname: string): void {
  const navigation = activeNavigation;
  if (!navigation || typeof performance === 'undefined') return;

  try {
    const durationMs = performance.now() - navigation.startedAt;
    const endMark = `${navigation.startMark}-end`;
    const measureName = `${navigation.startMark}-duration`;
    if (typeof performance.mark === 'function') performance.mark(endMark);
    if (typeof performance.measure === 'function') {
      performance.measure(measureName, navigation.startMark, endMark);
    }
    console.info(JSON.stringify({
      event: 'client_navigation_timing',
      route: safeRoute(pathname),
      navigationType: navigation.navigationType,
      durationMs: roundDuration(durationMs),
    }));
    if (typeof performance.clearMarks === 'function') {
      performance.clearMarks(navigation.startMark);
      performance.clearMarks(endMark);
    }
    if (typeof performance.clearMeasures === 'function') performance.clearMeasures(measureName);
  } catch {
    // Instrumentation must never affect navigation.
  } finally {
    activeNavigation = null;
  }
}
