import type { PlayerAnalyticsProfile } from '@/lib/player-analytics';

interface PlayerAdvancedMetricsProps {
  analytics: PlayerAnalyticsProfile;
  editionLabel: string;
  membershipLabel?: string | null;
}

function metricValue(metric: PlayerAnalyticsProfile['metrics'][number]): string {
  const { result } = metric;
  if (result.status === 'UNAVAILABLE') return 'Unavailable';
  if (result.status === 'INSUFFICIENT_SAMPLE' || result.value === null) return 'Small sample';
  if (result.unit === 'PERCENT') return `${result.value.toFixed(1)}%`;
  return result.value.toFixed(1);
}

function aggregationLabel(aggregation: string): string {
  if (aggregation === 'PER_60') return 'per 60 minutes';
  if (aggregation === 'PER_GAME') return 'per game';
  if (aggregation === 'WEIGHTED_PERCENTAGE') return 'weighted percentage';
  if (aggregation === 'RATING') return 'ratio';
  return 'total';
}

export function PlayerAdvancedMetrics({
  analytics,
  editionLabel,
  membershipLabel,
}: PlayerAdvancedMetricsProps) {
  const { impact } = analytics;

  return (
    <section className="space-y-6" aria-labelledby="advanced-metrics-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-label text-xs font-bold uppercase tracking-[0.2em] text-secondary">
            {editionLabel}
          </p>
          <h2 id="advanced-metrics-heading" className="font-headline text-3xl font-black tracking-tight text-primary">
            Advanced metrics
          </h2>
        </div>
        {membershipLabel && (
          <p className="font-label text-sm text-on-surface-variant">
            Listed for {membershipLabel}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {analytics.metrics.map((metric) => (
          <article key={`${metric.result.metricId}-${metric.result.aggregation}`} className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm">
            <p className="font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">
              {metric.displayName}
            </p>
            <p className="mt-2 font-headline text-3xl font-black text-primary">
              {metricValue(metric)}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {aggregationLabel(metric.result.aggregation)} · {metric.result.games} games · {metric.result.minutes.toFixed(0)} min
            </p>
            <details className="mt-4 text-xs text-on-surface-variant">
              <summary className="cursor-pointer font-semibold text-secondary">Definition</summary>
              <p className="mt-2 leading-relaxed">{metric.definition}</p>
              <p className="mt-2 font-mono">{metric.result.formulaVersion}</p>
              <p className="mt-1">Coverage: {metric.result.coverage.toLocaleLowerCase()}</p>
            </details>
          </article>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <article className="relative overflow-hidden rounded-2xl bg-primary-container p-6 text-white shadow-xl sm:p-8">
          <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full bg-secondary/15 blur-2xl" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <p className="font-label text-xs font-bold uppercase tracking-[0.2em] text-lime-300">
                  CentrePass model · not an official award
                </p>
                <h3 className="mt-2 font-headline text-2xl font-black">CentrePass Impact</h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
                  Position-aware per-60 contributions, standardized against this edition&apos;s {impact.positionGroup.toLocaleLowerCase()} population and pulled toward average for small samples.
                </p>
              </div>
              <div className="text-right">
                <p className="font-headline text-5xl font-black text-lime-300">
                  {impact.value?.toFixed(1) ?? '—'}
                </p>
                <p className="font-label text-xs uppercase tracking-wider text-slate-300">
                  {impact.status === 'INSUFFICIENT_SAMPLE' ? 'Minimum 30 minutes' : 'Impact rating'}
                </p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ImpactDetail label="Position percentile" value={impact.percentile === null ? '—' : `${impact.percentile.toFixed(0)}th`} />
              <ImpactDetail label="Population" value={`${impact.populationSize} players`} />
              <ImpactDetail label="Sample" value={`${impact.games} games · ${impact.minutes.toFixed(0)} min`} />
              <ImpactDetail label="Formula" value={impact.formulaVersion} />
            </div>
          </div>
        </article>

        <div className="space-y-4">
          {analytics.recentForm && (
            <article className="rounded-2xl bg-surface-container-lowest p-6 shadow-sm">
              <p className="font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">Rolling form</p>
              <p className="mt-2 font-headline text-3xl font-black text-primary">{metricValue(analytics.recentForm)}</p>
              <p className="mt-1 text-sm text-on-surface-variant">
                {analytics.recentForm.displayName} per game across the last {analytics.recentForm.result.games} official matches
              </p>
            </article>
          )}
          {analytics.officialNetPoints && (
            <article className="rounded-2xl border border-amber-400/30 bg-amber-50 p-6 dark:bg-amber-950/20">
              <p className="font-label text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Official source metric</p>
              <p className="mt-2 font-headline text-3xl font-black text-primary">{metricValue(analytics.officialNetPoints)}</p>
              <p className="mt-1 text-sm text-on-surface-variant">Official Net Points per game. This is separate from CentrePass Impact.</p>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

function ImpactDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <p className="font-label text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 break-words font-headline text-sm font-bold text-white">{value}</p>
    </div>
  );
}
