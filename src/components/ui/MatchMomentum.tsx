interface ScoreFlowPoint {
  period: number;
  homeScore: number;
  awayScore: number;
}

interface MatchMomentumProps {
  scoreFlow: ScoreFlowPoint[];
  homeTeam: string;
  awayTeam: string;
}

export function MatchMomentum({ scoreFlow, homeTeam, awayTeam }: MatchMomentumProps) {
  if (scoreFlow.length === 0) return null;

  const width = 400;
  const height = 160;
  const padding = 20;

  const maxScore = Math.max(
    ...scoreFlow.map((p) => Math.max(p.homeScore, p.awayScore)),
    1
  );

  const toX = (i: number) =>
    padding + (i / Math.max(scoreFlow.length - 1, 1)) * (width - padding * 2);
  const toY = (score: number) =>
    height - padding - (score / maxScore) * (height - padding * 2);

  const homeLine = scoreFlow.map((p, i) => `${toX(i)},${toY(p.homeScore)}`).join(' ');
  const awayLine = scoreFlow.map((p, i) => `${toX(i)},${toY(p.awayScore)}`).join(' ');

  return (
    <div className="bg-surface-container-low rounded-xl p-6">
      <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-6">
        Match Momentum
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <polyline
          points={homeLine}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary-container"
        />
        <polyline
          points={awayLine}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="6 3"
          className="text-secondary"
        />
      </svg>
      <div className="flex gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-primary-container" />
          <span className="text-[10px] font-bold font-label text-on-surface-variant uppercase">
            {homeTeam}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-secondary border-dashed" />
          <span className="text-[10px] font-bold font-label text-on-surface-variant uppercase">
            {awayTeam}
          </span>
        </div>
      </div>
    </div>
  );
}
