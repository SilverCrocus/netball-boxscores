interface Quarter {
  quarter: number;
  homeScore: number;
  awayScore: number;
}

interface QuarterScoreBarProps {
  quarters: Quarter[];
}

export function QuarterScoreBar({ quarters }: QuarterScoreBarProps) {
  return (
    <div className="space-y-4">
      {quarters.map((q) => {
        const total = q.homeScore + q.awayScore;
        const homePct = total > 0 ? (q.homeScore / total) * 100 : 50;
        const awayPct = total > 0 ? (q.awayScore / total) * 100 : 50;

        return (
          <div key={q.quarter} className="flex items-center gap-4" data-testid={`quarter-bar-${q.quarter}`}>
            <span className="text-[10px] font-bold font-label text-on-surface-variant w-8">
              Q{q.quarter}
            </span>
            <div className="flex-1 h-3 flex gap-1">
              <div
                className="bg-primary-container rounded-sm"
                style={{ width: `${homePct}%` }}
              />
              <div
                className="bg-secondary/40 rounded-sm"
                style={{ width: `${awayPct}%` }}
              />
            </div>
            <span className="text-[10px] font-bold font-label text-on-surface-variant w-12 text-right">
              {q.homeScore}-{q.awayScore}
            </span>
          </div>
        );
      })}
    </div>
  );
}
