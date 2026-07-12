'use client';

import { useCallback, useEffect, useState } from 'react';

interface SimMatchStatus {
  matchIndex: number;
  state: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: number;
  periodSeconds: number;
  tickCount: number;
  prismaMatchId: string;
}

interface SimStatusResponse {
  running: boolean;
  paused: boolean;
  speed: number;
  matches: SimMatchStatus[];
  log: Array<{ timestamp: number; matchIndex: number; message: string }>;
}

const SPEEDS = [1, 2, 5, 10, 50];
const STATES = [
  'pre-match', 'q1-active', 'q1-break', 'q2-active', 'q2-break',
  'q3-active', 'q3-break', 'q4-active', 'match-complete',
];

async function simControl(action: string, params: Record<string, unknown> = {}) {
  console.log(`[SimPanel] Sending action: ${action}`, params);
  try {
    const res = await fetch('/api/sim/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
    });
    const data = await res.json();
    console.log(`[SimPanel] Response for ${action}:`, data);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    console.error(`[SimPanel] Error for ${action}:`, err);
    throw err;
  }
}

async function fetchStatus(): Promise<SimStatusResponse> {
  const res = await fetch('/api/sim/status');
  return res.json();
}

export function SimPanel() {
  const [status, setStatus] = useState<SimStatusResponse | null>(null);
  const [matchCount, setMatchCount] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchStatus();
      setStatus(s);
      setError(null);
    } catch {
      setError('Failed to fetch simulation status');
    }
  }, []);

  // Poll status every second when running
  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refresh]);

  const handleStart = async () => {
    console.log('[SimPanel] Start clicked, matchCount:', matchCount);
    try {
      await simControl('start', { matchCount });
      await refresh();
    } catch (err) {
      setError(`Start failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStop = async () => {
    await simControl('stop');
    refresh();
  };

  const handlePause = async () => {
    await simControl('pause');
    refresh();
  };

  const handleResume = async () => {
    await simControl('resume');
    refresh();
  };

  const handleStep = async () => {
    await simControl('step');
    refresh();
  };

  const handleSpeed = async (speed: number) => {
    await simControl('speed', { multiplier: speed });
    refresh();
  };

  const handleGoto = async (matchIndex: number, state: string) => {
    await simControl('goto', { matchIndex, state });
    refresh();
  };

  return (
    <div className="min-h-screen bg-surface p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-headline font-bold text-on-surface">
            Simulation Control
          </h1>
          <p className="text-on-surface-variant mt-1">
            Control the live game simulation for E2E testing
          </p>
        </div>

        {error && (
          <div className="bg-error-container text-on-error-container p-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Controls */}
        <div className="bg-surface-container rounded-xl p-4 space-y-4">
          <h2 className="text-lg font-headline font-semibold text-on-surface">
            Controls
          </h2>

          <div className="flex flex-wrap gap-3 items-center">
            {!status?.running ? (
              <div className="flex items-center gap-3">
                <label className="text-sm text-on-surface-variant">Matches:</label>
                <select
                  value={matchCount}
                  onChange={(e) => setMatchCount(Number(e.target.value))}
                  className="bg-surface-container-high text-on-surface rounded-lg px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button
                  onClick={handleStart}
                  className="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90"
                >
                  Start
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleStop}
                  className="bg-error text-on-error px-4 py-2 rounded-lg text-sm font-medium hover:bg-error/90"
                >
                  Stop
                </button>
                {status.paused ? (
                  <button
                    onClick={handleResume}
                    className="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    onClick={handlePause}
                    className="bg-secondary text-on-secondary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Pause
                  </button>
                )}
                <button
                  onClick={handleStep}
                  className="bg-tertiary text-on-tertiary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Step
                </button>
              </>
            )}
          </div>

          {/* Speed control */}
          {status?.running && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-on-surface-variant">Speed:</span>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeed(s)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium ${
                    status.speed === s
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Match Cards */}
        {status?.matches && status.matches.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-headline font-semibold text-on-surface">
              Matches
            </h2>
            {status.matches.map((m) => (
              <div
                key={m.matchIndex}
                className="bg-surface-container rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-right min-w-[140px]">
                      <span className="font-semibold text-on-surface">
                        {m.homeTeam}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-2xl font-bold font-headline text-on-surface">
                        {m.homeScore} - {m.awayScore}
                      </span>
                    </div>
                    <div className="min-w-[140px]">
                      <span className="font-semibold text-on-surface">
                        {m.awayTeam}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                      {m.state}
                    </span>
                    {m.prismaMatchId && (
                      <a
                        href={`/match/${m.prismaMatchId}/live`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs bg-tertiary/10 text-tertiary px-2 py-1 rounded-full font-medium hover:bg-tertiary/20"
                      >
                        Open Live Page
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm text-on-surface-variant">
                  <span>Q{m.period}</span>
                  <span>{Math.floor(m.periodSeconds / 60)}:{String(m.periodSeconds % 60).padStart(2, '0')}</span>
                  <span>Tick #{m.tickCount}</span>
                </div>

                {/* Jump to state */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant">Jump to:</span>
                  <select
                    value={m.state}
                    onChange={(e) => handleGoto(m.matchIndex, e.target.value)}
                    className="bg-surface-container-high text-on-surface rounded-lg px-2 py-1 text-xs"
                  >
                    {STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Log */}
        {status?.log && status.log.length > 0 && (
          <div className="bg-surface-container rounded-xl p-4">
            <h2 className="text-lg font-headline font-semibold text-on-surface mb-3">
              Event Log
            </h2>
            <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
              {[...status.log].reverse().map((entry, i) => (
                <div key={i} className="text-on-surface-variant">
                  <span className="text-on-surface/50">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>{' '}
                  {entry.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
