'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import type { TeamInfo } from '@/types/team';

interface ScoreFlowPoint {
  period: number;
  periodSeconds: number;
  homeScore: number;
  awayScore: number;
}

interface ScoreProgressChartProps {
  scoreFlow: ScoreFlowPoint[];
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  currentQuarter?: number | null;
}

const FALLBACK_HOME = '#90b8f8';
const FALLBACK_AWAY = '#7de891';
const QUARTER_LENGTH = 900;
const ET_LENGTH = 300;

function formatTime(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const q = Math.floor(seconds / QUARTER_LENGTH) + 1;
  const intoQ = seconds % QUARTER_LENGTH;
  const remaining = QUARTER_LENGTH - intoQ;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `Q${q} ${m}:${s.toString().padStart(2, '0')}`;
}

export function ScoreProgressChart({
  scoreFlow,
  homeTeam,
  awayTeam,
  currentQuarter,
}: ScoreProgressChartProps) {
  const homeColor = homeTeam.primaryColor || FALLBACK_HOME;
  const awayColor = awayTeam.primaryColor || FALLBACK_AWAY;

  const maxQuarter = currentQuarter ?? (
    scoreFlow.length > 0 ? Math.max(...scoreFlow.map((sf) => sf.period), 4) : 4
  );
  const totalTime = maxQuarter <= 4
    ? 4 * QUARTER_LENGTH
    : 4 * QUARTER_LENGTH + (maxQuarter - 4) * ET_LENGTH;

  const data = useMemo(() => {
    const points = scoreFlow.map((sf) => ({
      time: (sf.period - 1) * QUARTER_LENGTH + sf.periodSeconds,
      home: sf.homeScore,
      away: sf.awayScore,
    }));
    // Origin + data + extend to current time
    const origin = { time: 0, home: 0, away: 0 };
    const all = [origin, ...points];
    const last = all[all.length - 1];
    // Extend line to current match time so it reaches toward the end
    if (last.time < totalTime) {
      all.push({ time: Math.min(last.time + 30, totalTime), home: last.home, away: last.away });
    }
    return all;
  }, [scoreFlow, totalTime]);

  // Quarter divider positions (between quarters)
  const quarterDividers = useMemo(() => {
    const dividers: { time: number; label: string }[] = [];
    for (let q = 1; q <= Math.min(maxQuarter, 4); q++) {
      dividers.push({ time: q * QUARTER_LENGTH, label: `Q${q}` });
    }
    for (let q = 5; q <= maxQuarter; q++) {
      dividers.push({
        time: 4 * QUARTER_LENGTH + (q - 4) * ET_LENGTH,
        label: `ET${q - 4}`,
      });
    }
    return dividers;
  }, [maxQuarter]);

  // X-axis ticks at quarter boundaries
  const xTicks = quarterDividers.map((d) => d.time);

  const maxScore = Math.max(...data.map((d) => Math.max(d.home, d.away)), 1);

  if (scoreFlow.length === 0) return null;

  return (
    <div className="bg-surface-container-lowest rounded-xl px-4 pt-3 pb-1 shadow-sm border border-outline-variant/15">
      <div className="flex items-center gap-3 mb-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: homeColor }} />
          <span className="font-label text-[10px] font-bold text-on-surface-variant/70">
            {homeTeam.abbreviation}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: awayColor }} />
          <span className="font-label text-[10px] font-bold text-on-surface-variant/70">
            {awayTeam.abbreviation}
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <XAxis
            dataKey="time"
            type="number"
            domain={[0, totalTime]}
            ticks={xTicks}
            tickFormatter={(t: number) => {
              const d = quarterDividers.find((qd) => qd.time === t);
              return d?.label ?? '';
            }}
            tick={{ fontSize: 10, fill: 'var(--color-on-surface-variant)', opacity: 0.4, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, Math.ceil(maxScore * 1.05)]}
            hide
          />
          {/* Quarter divider lines */}
          {quarterDividers.map((d) => (
            <ReferenceLine
              key={d.time}
              x={d.time}
              stroke="var(--color-outline-variant)"
              strokeOpacity={0.2}
              strokeDasharray="4 3"
            />
          ))}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { time: number; home: number; away: number };
              return (
                <div className="bg-surface-container rounded-lg px-3 py-2 shadow-md border border-outline-variant/20 font-label text-[11px]">
                  <div className="text-on-surface-variant/50 mb-1">{formatTime(d.time)}</div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: homeColor }} />
                    <span className="text-on-surface font-bold">{homeTeam.abbreviation} {d.home}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: awayColor }} />
                    <span className="text-on-surface font-bold">{awayTeam.abbreviation} {d.away}</span>
                  </div>
                </div>
              );
            }}
            cursor={{ stroke: 'var(--color-outline-variant)', strokeOpacity: 0.3 }}
          />
          <Line
            type="stepAfter"
            dataKey="home"
            stroke={homeColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: homeColor, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            type="stepAfter"
            dataKey="away"
            stroke={awayColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: awayColor, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
