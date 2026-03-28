interface StatBar {
  label: string;
  homeValue: number;
  awayValue: number;
  format?: 'number' | 'percentage';
}

interface MatchStatsComparisonProps {
  stats: StatBar[];
}

export function MatchStatsComparison({ stats }: MatchStatsComparisonProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
      <div className="flex justify-between items-center mb-8">
        <h3 className="font-headline text-xl font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            analytics
          </span>
          Key Match Stats
        </h3>
      </div>
      <div className="space-y-6">
        {stats.map((stat) => {
          const total = stat.homeValue + stat.awayValue;
          const homePct = total > 0 ? (stat.homeValue / total) * 100 : 50;
          const awayPct = 100 - homePct;
          const suffix = stat.format === 'percentage' ? '%' : '';

          return (
            <div key={stat.label} className="space-y-2">
              <div className="flex justify-between text-xs font-bold font-label uppercase">
                <span>
                  {stat.homeValue}
                  {suffix}
                </span>
                <span>{stat.label}</span>
                <span>
                  {stat.awayValue}
                  {suffix}
                </span>
              </div>
              <div className="h-2.5 w-full bg-surface-container-high rounded overflow-hidden flex">
                <div
                  className="h-full bg-primary-container rounded-l"
                  style={{ width: `${homePct}%` }}
                />
                <div
                  className="h-full bg-secondary rounded-r"
                  style={{ width: `${awayPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
