import Link from 'next/link';
import type { PlayerMatchStats } from '@prisma/client';
import { getStatValue, computeShootingPct } from '@/lib/stat-utils';
import type { PositionConfig, StatHighlight } from './position-config';

interface CompetitionInfo {
  id: string;
  season: number;
  name: string;
  slug: string | null;
  label: string | null;
}

interface PlayerSeasonStatsProps {
  matchStats: PlayerMatchStats[];
  positionConfig: PositionConfig;
  totalSuperShots?: number;
  competitions?: CompetitionInfo[];
  selectedCompetitionId?: string;
  playerId?: string;
}

function computeSeasonTotal(stats: PlayerMatchStats[], field: string): number {
  if (field === 'shootingPct') {
    const totalGoals = stats.reduce((sum, s) => sum + s.goals, 0);
    const totalAttempts = stats.reduce((sum, s) => sum + s.attempts, 0);
    return computeShootingPct(totalGoals, totalAttempts);
  }
  return stats.reduce((sum, s) => sum + getStatValue(s, field), 0);
}

function computeSeasonMax(stats: PlayerMatchStats[], field: string): number {
  if (stats.length === 0) return 0;
  return Math.max(...stats.map((s) => getStatValue(s, field)));
}

export function computeTrend(
  stats: PlayerMatchStats[],
  field: string,
): { value: string; positive: boolean } | null {
  if (stats.length < 2) return null;

  // Player page queries match stats newest-first.
  const current = getStatValue(stats[0], field);
  const previous = getStatValue(stats[1], field);

  if (previous === 0) {
    if (current === 0) return null;
    return { value: `+${current.toFixed(0)}`, positive: true };
  }

  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? '+' : '';
  return {
    value: `${sign}${change.toFixed(0)}%`,
    positive: change >= 0,
  };
}

export function computeProgressPercentage(
  total: number,
  singleGameMax: number,
  gamesPlayed: number,
  isPercentage: boolean,
): number {
  if (isPercentage) return Math.min(Math.max(total, 0), 100);
  if (singleGameMax <= 0 || gamesPlayed <= 0) return 0;
  return Math.min(Math.max((total / (singleGameMax * gamesPlayed)) * 100, 0), 100);
}

function StatHighlightCard({
  highlight,
  total,
  max,
  trend,
  format,
  gamesPlayed,
}: {
  highlight: StatHighlight;
  total: number;
  max: number;
  trend: { value: string; positive: boolean } | null;
  format?: 'percentage' | 'number';
  gamesPlayed: number;
}) {
  const progressPct = computeProgressPercentage(
    total,
    max,
    gamesPlayed,
    format === 'percentage',
  );
  const displayValue = format === 'percentage' ? `${total.toFixed(1)}%` : total.toString();

  return (
    <div className="flex flex-col border-l-4 border-secondary pl-4">
      <div className="flex items-baseline gap-2">
        <span className="font-headline text-5xl font-black text-primary mb-1">
          {displayValue}
        </span>
        {trend && (
          <span
            className={`font-bold text-sm ${
              trend.positive ? 'text-lime-400' : 'text-error'
            }`}
          >
            {trend.positive ? '\u2191' : '\u2193'} {trend.value}
          </span>
        )}
      </div>
      <span className="font-label text-sm text-on-surface-variant font-semibold uppercase tracking-wider">
        {highlight.label}
      </span>
      <div className="w-full h-1 bg-surface-container-high mt-4 rounded-full overflow-hidden">
        <div
          className="h-full bg-secondary rounded-full transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

const ALL_STAT_FIELDS = [
  { field: 'goals', label: 'Goals' },
  { field: 'attempts', label: 'Attempts' },
  { field: 'goalAssists', label: 'Goal Assists' },
  { field: 'intercepts', label: 'Intercepts' },
  { field: 'deflections', label: 'Deflections' },
  { field: 'rebounds', label: 'Rebounds' },
  { field: 'penalties', label: 'Penalties' },
  { field: 'feeds', label: 'Feeds' },
  { field: 'centrePassReceives', label: 'Centre Pass Receives' },
  { field: 'turnovers', label: 'Turnovers' },
  { field: 'minutesPlayed', label: 'Minutes Played' },
] as const;

export default function PlayerSeasonStats({
  matchStats,
  positionConfig,
  totalSuperShots,
  competitions,
  selectedCompetitionId,
  playerId,
}: PlayerSeasonStatsProps) {
  if (matchStats.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-headline text-2xl font-black text-primary uppercase tracking-tight">
            Season Stats
          </h2>
          {competitions && competitions.length > 1 && playerId && (
            <EditionSelector competitions={competitions} selectedCompetitionId={selectedCompetitionId} playerId={playerId} />
          )}
        </div>
        <p className="text-on-surface-variant font-body">
          No match data available for this season
        </p>
      </div>
    );
  }

  const gamesPlayed = matchStats.length;

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-sm">
      <div className="flex justify-between items-center mb-8">
        <h2 className="font-headline text-2xl font-black text-primary uppercase tracking-tight">
          Season Stats
        </h2>
        <div className="flex items-center gap-3">
          {competitions && competitions.length > 1 && playerId && (
            <EditionSelector competitions={competitions} selectedCompetitionId={selectedCompetitionId} playerId={playerId} />
          )}
          <div className="px-3 py-1 bg-surface-container-high rounded text-xs font-bold uppercase tracking-widest">
            {gamesPlayed} {gamesPlayed === 1 ? 'Game' : 'Games'}
          </div>
        </div>
      </div>

      {/* Position-specific highlight cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-10">
        {positionConfig.highlights.map((highlight) => {
          const total = computeSeasonTotal(matchStats, highlight.statField);
          const max = computeSeasonMax(matchStats, highlight.statField);
          const trend = computeTrend(matchStats, highlight.statField);

          // For shootingPct, use the season-wide total as both value and max reference
          const progressMax = highlight.statField === 'shootingPct' ? 100 : max;

          return (
            <StatHighlightCard
              key={highlight.key}
              highlight={highlight}
              total={total}
              max={progressMax}
              trend={trend}
              format={highlight.format}
              gamesPlayed={gamesPlayed}
            />
          );
        })}
      </div>

      {/* Season Averages */}
      <div>
        <h3 className="font-headline text-lg font-bold text-primary uppercase tracking-tight mb-4">
          Season Averages
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {ALL_STAT_FIELDS.map(({ field, label }) => {
            const total = computeSeasonTotal(matchStats, field);
            const avg = (total / gamesPlayed).toFixed(1);

            return (
              <div
                key={field}
                className="bg-surface-container-low rounded-lg p-3"
              >
                <p className="font-label text-xs text-on-surface-variant uppercase tracking-wider mb-1">
                  {label}
                </p>
                <p className="font-headline text-xl font-bold text-primary">
                  {avg}
                </p>
              </div>
            );
          })}
          {totalSuperShots != null && (
            <div className="bg-surface-container-low rounded-lg p-3">
              <p className="font-label text-xs text-on-surface-variant uppercase tracking-wider mb-1">
                Super Shots
              </p>
              <p className="font-headline text-xl font-bold text-amber-600">
                {(totalSuperShots / gamesPlayed).toFixed(1)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditionSelector({ competitions, selectedCompetitionId, playerId }: { competitions: CompetitionInfo[]; selectedCompetitionId?: string; playerId: string }) {
  return (
    <div className="flex gap-1">
      {competitions.map((c) => (
        <Link
          key={c.id}
          href={`/player/${playerId}?edition=${encodeURIComponent(c.id)}`}
          className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-widest transition-colors ${
            c.id === selectedCompetitionId
              ? 'bg-primary-container text-white'
              : 'bg-surface-container-high text-on-surface-variant hover:text-primary-container'
          }`}
        >
          {c.label ?? c.season}
        </Link>
      ))}
    </div>
  );
}
