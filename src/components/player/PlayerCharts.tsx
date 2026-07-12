import type { PlayerMatchStats } from '@prisma/client';
import { getStatValue, computeShootingPct } from '@/lib/stat-utils';
import type { PositionConfig } from './position-config';

interface PlayerChartsProps {
  matchStats: PlayerMatchStats[];
  positionConfig: PositionConfig;
}

function PrimaryBarChart({
  matchStats,
  statField,
  label,
}: {
  matchStats: PlayerMatchStats[];
  statField: string;
  label: string;
}) {
  const values = matchStats.map((s) => getStatValue(s, statField));
  const maxVal = Math.max(...values, 1);

  return (
    <div className="bg-primary-container rounded-2xl p-8 text-white relative overflow-hidden">
      <h3 className="font-headline text-xl font-bold mb-6">
        {label} Per Match
      </h3>
      <div className="h-48 flex gap-3 px-2">
        {matchStats.map((stat, i) => {
          const value = values[i];
          const heightPct = Math.max((value / maxVal) * 100, 4);

          return (
            <div key={stat.id} className="flex flex-col items-center flex-1 max-w-20 min-w-0">
              <div className="flex-1 w-full flex flex-col items-center justify-end min-h-0">
                <span className="text-sm font-bold text-lime-400 mb-1 shrink-0">
                  {statField === 'shootingPct' ? `${value.toFixed(0)}%` : value}
                </span>
                <div
                  className="w-full rounded-t-md bg-lime-400"
                  style={{
                    height: `${heightPct}%`,
                    maxHeight: 'calc(100% - 1.5rem)',
                    opacity: 0.4 + (i / (matchStats.length - 1 || 1)) * 0.6,
                  }}
                />
              </div>
              <span className="text-[10px] mt-2 font-bold text-slate-400">
                R{i + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShooterDonutChart({ matchStats }: { matchStats: PlayerMatchStats[] }) {
  const totalGoals = matchStats.reduce((sum, s) => sum + s.goals, 0);
  const totalAttempts = matchStats.reduce((sum, s) => sum + s.attempts, 0);
  const accuracy = computeShootingPct(totalGoals, totalAttempts);
  const missedPct = 100 - accuracy;

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm">
      <h3 className="font-headline text-xl font-bold text-primary mb-6">
        Goal Accuracy
      </h3>
      <div className="flex items-center justify-center">
        <div className="relative w-48 h-48">
          {/* Donut via conic-gradient */}
          <div
            className="w-full h-full rounded-full"
            style={{
              background: `conic-gradient(
                #a3e635 0% ${accuracy}%,
                #334155 ${accuracy}% ${accuracy + missedPct}%
              )`,
            }}
          />
          {/* Inner cutout */}
          <div className="absolute inset-4 bg-surface-container-lowest rounded-full flex items-center justify-center">
            <div className="text-center">
              <span className="font-headline text-4xl font-black text-primary">
                {accuracy.toFixed(1)}%
              </span>
              <p className="font-label text-xs text-on-surface-variant uppercase tracking-wider mt-1">
                Accuracy
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-center gap-6 mt-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-lime-400" />
          <span className="font-label text-sm text-on-surface-variant">
            Goals ({totalGoals})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-slate-700" />
          <span className="font-label text-sm text-on-surface-variant">
            Missed ({totalAttempts - totalGoals})
          </span>
        </div>
      </div>
    </div>
  );
}

function DefenderStackedBar({
  matchStats,
}: {
  matchStats: PlayerMatchStats[];
}) {
  const maxTotal = Math.max(
    ...matchStats.map((s) => s.intercepts + s.deflections + s.rebounds),
    1,
  );

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm">
      <h3 className="font-headline text-xl font-bold text-primary mb-6">
        Defensive Actions Per Match
      </h3>
      <div className="h-40 flex justify-between gap-1.5">
        {matchStats.map((stat, i) => {
          const total = stat.intercepts + stat.deflections + stat.rebounds;
          const heightPct = (total / maxTotal) * 100;
          const interceptPct = total > 0 ? (stat.intercepts / total) * 100 : 0;
          const deflectionPct =
            total > 0 ? (stat.deflections / total) * 100 : 0;

          return (
            <div
              key={stat.id}
              className="flex flex-col items-center flex-1 min-w-0"
            >
              <div className="flex-1 w-full flex items-end">
                <div
                  className="w-full rounded-t-sm overflow-hidden"
                  style={{ height: `${heightPct}%` }}
                >
                  <div
                    className="w-full bg-secondary"
                    style={{ height: `${interceptPct}%` }}
                  />
                  <div
                    className="w-full bg-lime-400"
                    style={{ height: `${deflectionPct}%` }}
                  />
                  <div
                    className="w-full bg-outline-variant"
                    style={{ height: `${100 - interceptPct - deflectionPct}%` }}
                  />
                </div>
              </div>
              <span className="text-[10px] mt-2 font-bold text-on-surface-variant truncate">
                R{i + 1}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-secondary" />
          <span className="font-label text-sm text-on-surface-variant">
            Intercepts
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-lime-400" />
          <span className="font-label text-sm text-on-surface-variant">
            Deflections
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-outline-variant" />
          <span className="font-label text-sm text-on-surface-variant">
            Rebounds
          </span>
        </div>
      </div>
    </div>
  );
}

function MidcourtFeedDistribution({
  matchStats,
}: {
  matchStats: PlayerMatchStats[];
}) {
  const maxVal = Math.max(
    ...matchStats.flatMap((s) => [s.goalAssists, s.feeds]),
    1,
  );

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm">
      <h3 className="font-headline text-xl font-bold text-primary mb-6">
        Feed Distribution
      </h3>
      <div className="h-40 flex justify-between gap-1.5">
        {matchStats.map((stat) => {
          const assistHeight = (stat.goalAssists / maxVal) * 100;
          const feedHeight = (stat.feeds / maxVal) * 100;

          return (
            <div
              key={stat.id}
              className="flex items-end gap-0.5 flex-1 min-w-0"
            >
              <div
                className="flex-1 bg-secondary rounded-t-sm transition-all duration-300"
                style={{ height: `${assistHeight}%` }}
              />
              <div
                className="flex-1 bg-lime-400 rounded-t-sm transition-all duration-300"
                style={{ height: `${feedHeight}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-end justify-between mt-1 px-0.5">
        {matchStats.map((_, i) => (
          <span
            key={i}
            className="text-[10px] font-bold text-on-surface-variant flex-1 min-w-0 text-center"
          >
            R{i + 1}
          </span>
        ))}
      </div>
      <div className="flex gap-4 mt-6">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-secondary" />
          <span className="font-label text-sm text-on-surface-variant">
            Goal Assists
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-lime-400" />
          <span className="font-label text-sm text-on-surface-variant">
            Feeds
          </span>
        </div>
      </div>
    </div>
  );
}

export default function PlayerCharts({
  matchStats,
  positionConfig,
}: PlayerChartsProps) {
  if (matchStats.length === 0) return null;

  if (positionConfig.group === 'shooter') {
    return <ShooterDonutChart matchStats={matchStats} />;
  }

  if (positionConfig.group === 'defender') {
    return <DefenderStackedBar matchStats={matchStats} />;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <PrimaryBarChart
        matchStats={matchStats}
        statField={positionConfig.primaryChartStat}
        label={positionConfig.primaryChartLabel}
      />

      {positionConfig.group === 'midcourt' && (
        <MidcourtFeedDistribution matchStats={matchStats} />
      )}
    </div>
  );
}
