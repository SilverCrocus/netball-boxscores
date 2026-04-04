'use client';

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

/**
 * SVG line graph showing score progression for both teams over the match.
 * X-axis = match time (across quarters), Y-axis = score.
 * Renders with CSS/SVG only — no external charting library.
 */
export function ScoreProgressChart({
  scoreFlow,
  homeTeam,
  awayTeam,
  currentQuarter,
}: ScoreProgressChartProps) {
  if (scoreFlow.length === 0) return null;

  // Convert score flow to cumulative time (seconds from match start)
  const QUARTER_LENGTH = 900; // 15 minutes
  const ET_LENGTH = 300; // 5 minutes extra time

  const points = scoreFlow.map((sf) => {
    const quarterOffset = (sf.period - 1) * QUARTER_LENGTH;
    return {
      time: quarterOffset + sf.periodSeconds,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
    };
  });

  // Add origin point
  const allPoints = [{ time: 0, homeScore: 0, awayScore: 0 }, ...points];

  const maxQuarter = currentQuarter ?? Math.max(...scoreFlow.map((sf) => sf.period), 4);
  const totalTime = maxQuarter <= 4
    ? maxQuarter * QUARTER_LENGTH
    : 4 * QUARTER_LENGTH + (maxQuarter - 4) * ET_LENGTH;

  const maxScore = Math.max(
    ...allPoints.map((p) => Math.max(p.homeScore, p.awayScore)),
    1, // avoid 0
  );

  // SVG dimensions
  const W = 600;
  const H = 200;
  const PAD_LEFT = 32;
  const PAD_RIGHT = 8;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 24;
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const plotH = H - PAD_TOP - PAD_BOTTOM;

  function x(time: number) {
    return PAD_LEFT + (time / totalTime) * plotW;
  }
  function y(score: number) {
    return PAD_TOP + plotH - (score / maxScore) * plotH;
  }

  // Build SVG path strings (step function — score changes are instant)
  function buildPath(key: 'homeScore' | 'awayScore') {
    if (allPoints.length === 0) return '';
    let d = `M ${x(allPoints[0].time)} ${y(allPoints[0][key])}`;
    for (let i = 1; i < allPoints.length; i++) {
      // Horizontal step to new time at old score, then vertical to new score
      d += ` L ${x(allPoints[i].time)} ${y(allPoints[i - 1][key])}`;
      d += ` L ${x(allPoints[i].time)} ${y(allPoints[i][key])}`;
    }
    // Extend to current time at last score
    const lastPoint = allPoints[allPoints.length - 1];
    const currentTime = Math.min(lastPoint.time + 30, totalTime); // extend slightly past last point
    d += ` L ${x(currentTime)} ${y(lastPoint[key])}`;
    return d;
  }

  const homePath = buildPath('homeScore');
  const awayPath = buildPath('awayScore');

  // Quarter divider lines
  const quarterLines: number[] = [];
  for (let q = 1; q < maxQuarter; q++) {
    quarterLines.push(q * QUARTER_LENGTH);
  }

  // Y-axis grid lines
  const yGridCount = 4;
  const yStep = Math.ceil(maxScore / yGridCount);
  const yGridValues: number[] = [];
  for (let v = yStep; v <= maxScore; v += yStep) {
    yGridValues.push(v);
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl p-5 shadow-sm border border-outline-variant/15">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-headline text-sm font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-[18px]">
            show_chart
          </span>
          Score Progression
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#90b8f8] rounded" />
            <span className="font-label text-[10px] text-on-surface-variant">{homeTeam.abbreviation}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-[#7de891] rounded" />
            <span className="font-label text-[10px] text-on-surface-variant">{awayTeam.abbreviation}</span>
          </div>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis grid */}
        {yGridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD_LEFT}
              y1={y(v)}
              x2={W - PAD_RIGHT}
              y2={y(v)}
              stroke="currentColor"
              className="text-outline-variant/10"
              strokeWidth={0.5}
            />
            <text
              x={PAD_LEFT - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-on-surface-variant/40"
              fontSize={9}
              fontFamily="var(--font-label, sans-serif)"
            >
              {v}
            </text>
          </g>
        ))}

        {/* Quarter dividers */}
        {quarterLines.map((t, i) => (
          <g key={t}>
            <line
              x1={x(t)}
              y1={PAD_TOP}
              x2={x(t)}
              y2={H - PAD_BOTTOM}
              stroke="currentColor"
              className="text-outline-variant/15"
              strokeWidth={0.5}
              strokeDasharray="4 3"
            />
            <text
              x={x(t)}
              y={H - PAD_BOTTOM + 14}
              textAnchor="middle"
              className="fill-on-surface-variant/40"
              fontSize={9}
              fontFamily="var(--font-label, sans-serif)"
            >
              Q{i + 1}
            </text>
          </g>
        ))}
        {/* Last quarter label */}
        <text
          x={x(totalTime)}
          y={H - PAD_BOTTOM + 14}
          textAnchor="middle"
          className="fill-on-surface-variant/40"
          fontSize={9}
          fontFamily="var(--font-label, sans-serif)"
        >
          {maxQuarter > 4 ? 'ET' : `Q${maxQuarter}`}
        </text>

        {/* Home team line */}
        <path
          d={homePath}
          fill="none"
          stroke="#90b8f8"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Away team line */}
        <path
          d={awayPath}
          fill="none"
          stroke="#7de891"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current score dots */}
        {allPoints.length > 1 && (
          <>
            <circle
              cx={x(allPoints[allPoints.length - 1].time)}
              cy={y(allPoints[allPoints.length - 1].homeScore)}
              r={3}
              fill="#90b8f8"
            />
            <circle
              cx={x(allPoints[allPoints.length - 1].time)}
              cy={y(allPoints[allPoints.length - 1].awayScore)}
              r={3}
              fill="#7de891"
            />
          </>
        )}
      </svg>
    </div>
  );
}
