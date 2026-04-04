'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Takes the last known periodSeconds from Champion Data and ticks it up
 * locally every second, so the game clock appears to update in real-time
 * between worker polls.
 *
 * Resets whenever a new server value arrives (socket update).
 */
export function useLocalClock(serverPeriodSeconds: string | null | undefined): string | null {
  const [localSeconds, setLocalSeconds] = useState<number | null>(null);
  const lastServerValue = useRef<string | null | undefined>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // When server sends a new value, sync to it
    if (serverPeriodSeconds !== lastServerValue.current) {
      lastServerValue.current = serverPeriodSeconds;
      const parsed = Number(serverPeriodSeconds);
      if (!isNaN(parsed)) {
        setLocalSeconds(parsed);
      } else {
        setLocalSeconds(null);
      }
    }
  }, [serverPeriodSeconds]);

  useEffect(() => {
    if (localSeconds === null) return;

    intervalRef.current = setInterval(() => {
      setLocalSeconds((prev) => (prev !== null ? prev + 1 : null));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [localSeconds !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (localSeconds === null) return null;
  return String(localSeconds);
}
