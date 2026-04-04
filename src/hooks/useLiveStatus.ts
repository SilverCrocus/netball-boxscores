'use client';

import { useState, useEffect } from 'react';

interface LiveStatus {
  hasLive: boolean;
  minutesUntilNext: number | null;
}

export function useLiveStatus(): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>({
    hasLive: false,
    minutesUntilNext: null,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/live-status');
        const data = await res.json();

        const minutesUntilNext = data.nextMatchAt
          ? Math.max(0, Math.ceil((new Date(data.nextMatchAt).getTime() - Date.now()) / 60000))
          : null;

        setStatus({ hasLive: data.hasLive, minutesUntilNext });
      } catch {
        // Silently fail — nav still works, just no countdown
      }
    }

    fetchStatus();
    // Refresh every 30s to keep countdown accurate
    timer = setInterval(fetchStatus, 30000);

    return () => clearInterval(timer);
  }, []);

  return status;
}
