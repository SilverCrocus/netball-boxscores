'use client';

import { useSyncExternalStore } from 'react';

export interface LiveStatus {
  hasLive: boolean;
  minutesUntilNext: number | null;
}

const INITIAL_STATUS: LiveStatus = {
  hasLive: false,
  minutesUntilNext: null,
};

const listeners = new Set<() => void>();
let snapshot = INITIAL_STATUS;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let requestInFlight: Promise<void> | null = null;

function emit(nextStatus: LiveStatus) {
  if (
    nextStatus.hasLive === snapshot.hasLive &&
    nextStatus.minutesUntilNext === snapshot.minutesUntilNext
  ) {
    return;
  }

  snapshot = nextStatus;
  for (const listener of listeners) listener();
}

function fetchLiveStatus(): Promise<void> {
  if (requestInFlight) return requestInFlight;

  requestInFlight = (async () => {
    try {
      const response = await fetch('/api/live-status', { cache: 'no-store' });
      if (!response.ok) return;

      const data = await response.json() as {
        hasLive?: boolean;
        nextMatchAt?: string | null;
      };
      const minutesUntilNext = data.nextMatchAt
        ? Math.max(0, Math.ceil((new Date(data.nextMatchAt).getTime() - Date.now()) / 60000))
        : null;

      emit({ hasLive: data.hasLive === true, minutesUntilNext });
    } catch {
      // Navigation remains usable with the last known status during a transient failure.
    } finally {
      requestInFlight = null;
    }
  })();

  return requestInFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (listeners.size === 1) {
    void fetchLiveStatus();
    pollTimer = setInterval(() => void fetchLiveStatus(), 30_000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

function getSnapshot() {
  return snapshot;
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATUS);
}
