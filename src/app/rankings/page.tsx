import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listAnalyticsEditions } from '@/lib/analytics/repository';
import { getMetricDefinition, metricCatalogue } from '@/lib/analytics';
import type { MetricAggregation, MetricResult } from '@/lib/analytics';
import { TEAM_POWER_METHODOLOGY } from '@/lib/rankings';
import { getPlayerRankingSnapshot, getTeamPowerSnapshot } from '@/lib/rankings/service';
import { analyticsFeaturesEnabled } from '@/lib/server-feature-flags';
import { measureServerOperation } from '@/lib/server-timing';

export const metadata: Metadata = {
  title: 'Player & Team Rankings',
  description: 'Versioned CentrePass player rankings and team power ratings with transparent samples and methodology.',
};

interface RankingsPageProps {
  searchParams: Promise<{
    edition?: string;
    view?: string;
    metric?: string;
    aggregation?: string;
    position?: string;
    minimumMinutes?: string;
    lastN?: string;
  }>;
}

const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'] as const;
const PLAYER_METRICS = metricCatalogue.filter((metric) => metric.entityTypes.includes('PLAYER'));

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function valueLabel(result: MetricResult): string {
  if (result.value === null) return '—';
  if (result.unit === 'PERCENT') return `${result.value.toFixed(1)}%`;
  return result.value.toFixed(1);
}

function dateLabel(value: string | null): string {
  if (!value) return 'No eligible results yet';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ordinal(value: number): string {
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  if (rounded % 10 === 1) return `${rounded}st`;
  if (rounded % 10 === 2) return `${rounded}nd`;
  if (rounded % 10 === 3) return `${rounded}rd`;
  return `${rounded}th`;
}

export default function RankingsPage(props: RankingsPageProps) {
  return measureServerOperation('/rankings', 'rankings-page', () => renderRankingsPage(props));
}

async function renderRankingsPage({ searchParams }: RankingsPageProps) {
  if (!analyticsFeaturesEnabled()) notFound();
  const query = await searchParams;
  const editions = await listAnalyticsEditions();
  const edition = editions.find((option) => option.id === query.edition || option.slug === query.edition) ?? editions[0] ?? null;
  const view = query.view === 'teams' ? 'teams' : 'players';
  const requestedMetric = getMetricDefinition(query.metric ?? 'centrepass_impact');
  const metric = requestedMetric?.entityTypes.includes('PLAYER') ? requestedMetric : getMetricDefinition('centrepass_impact')!;
  const requestedAggregation = query.aggregation as MetricAggregation | undefined;
  const aggregation = requestedAggregation && metric.allowedAggregations.includes(requestedAggregation)
    ? requestedAggregation
    : metric.defaultAggregation;
  const position = POSITIONS.includes(query.position as typeof POSITIONS[number]) ? query.position : undefined;
  const minimumMinutes = boundedInteger(query.minimumMinutes, 120, 0, 10_000);
  const lastN = query.lastN ? boundedInteger(query.lastN, 5, 1, 100) : undefined;

  const playerSnapshot = edition && view === 'players'
    ? await getPlayerRankingSnapshot({
      competitionId: edition.id,
      metricId: metric.id,
      aggregation,
      position,
      minimumMinutes,
      lastN,
    })
    : null;
  const teamSnapshot = edition && view === 'teams'
    ? await getTeamPowerSnapshot(edition.id)
    : null;
  const snapshot = playerSnapshot ?? teamSnapshot;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="overflow-hidden rounded-3xl bg-primary-container px-6 py-8 text-white shadow-xl sm:px-10 sm:py-12">
        <p className="font-label text-xs font-bold uppercase tracking-[0.22em] text-lime-300">Transparent analytics</p>
        <h1 className="mt-3 font-headline text-4xl font-black tracking-tight sm:text-6xl">CentrePass Rankings</h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
          Edition-scoped player leaderboards and team power ratings. Every result includes its sample, formula version, coverage, and as-of time.
        </p>
      </header>

      <nav aria-label="Ranking type" className="flex gap-2">
        <RankingTab href={rankingHref(query, { view: 'players' })} active={view === 'players'}>Player rankings</RankingTab>
        <RankingTab href={rankingHref(query, { view: 'teams' })} active={view === 'teams'}>Team power</RankingTab>
      </nav>

      <form method="get" className="grid gap-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm md:grid-cols-3 xl:grid-cols-6">
        <input type="hidden" name="view" value={view} />
        <Filter label="Edition">
          <select name="edition" defaultValue={edition?.id} className="filter-control">
            {editions.map((option) => <option key={option.id} value={option.id}>{option.series.name} · {option.label ?? option.season}</option>)}
          </select>
        </Filter>
        {view === 'players' && (
          <>
            <Filter label="Metric">
              <select name="metric" defaultValue={metric.id} className="filter-control">
                {PLAYER_METRICS.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}
              </select>
            </Filter>
            <Filter label="Mode">
              <select name="aggregation" defaultValue={aggregation} className="filter-control">
                {metric.allowedAggregations.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ').toLocaleLowerCase()}</option>)}
              </select>
            </Filter>
            <Filter label="Position">
              <select name="position" defaultValue={position ?? ''} className="filter-control">
                <option value="">All positions</option>
                {POSITIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Filter>
            <Filter label="Minimum minutes">
              <input name="minimumMinutes" type="number" min="0" max="10000" defaultValue={minimumMinutes} className="filter-control" />
            </Filter>
            <Filter label="Window">
              <select name="lastN" defaultValue={lastN ?? ''} className="filter-control">
                <option value="">Whole edition</option>
                {[3, 5, 10, 20].map((option) => <option key={option} value={option}>Last {option}</option>)}
              </select>
            </Filter>
          </>
        )}
        <button type="submit" className="min-h-11 self-end rounded-xl bg-secondary px-5 font-headline text-sm font-bold text-white xl:col-start-6">
          Update rankings
        </button>
      </form>

      {!edition ? (
        <EmptyState title="No published edition" body="Publish a competition edition before calculating rankings." />
      ) : !snapshot || snapshot.entries.length === 0 ? (
        <EmptyState title="No eligible ranking sample" body="No official, covered results meet these ranking filters yet." />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Ranking audit details">
            <AuditCard label="Edition" value={`${edition.series.name} · ${edition.label ?? edition.season}`} />
            <AuditCard label="Population" value={`${snapshot.populationSize} ${view === 'teams' ? 'teams' : 'players'}`} />
            <AuditCard label="As of" value={dateLabel(snapshot.asOf)} />
            <AuditCard label="Movement basis" value="New snapshot · no prior comparison" />
          </section>

          {playerSnapshot ? (
            <PlayerRankingTable snapshot={playerSnapshot} />
          ) : teamSnapshot ? (
            <TeamPowerTable snapshot={teamSnapshot} />
          ) : null}
        </>
      )}
    </div>
  );
}

function rankingHref(current: Record<string, string | undefined>, next: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...next })) if (value) params.set(key, value);
  return `/rankings?${params.toString()}`;
}

function RankingTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link prefetch={false} href={href} className={`rounded-xl px-4 py-3 font-headline text-sm font-bold ${active ? 'bg-secondary text-white' : 'bg-surface-container-high text-on-surface-variant'}`}>{children}</Link>;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">{label}{children}</label>;
}

function AuditCard({ label, value }: { label: string; value: string }) {
  return <article className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm"><p className="font-label text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p><p className="mt-2 font-headline text-base font-bold text-primary">{value}</p></article>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="rounded-2xl bg-surface-container-lowest px-6 py-14 text-center shadow-sm"><h2 className="font-headline text-2xl font-black text-primary">{title}</h2><p className="mt-2 text-on-surface-variant">{body}</p></section>;
}

function PlayerRankingTable({ snapshot }: { snapshot: Awaited<ReturnType<typeof getPlayerRankingSnapshot>> }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl">
      <div className="flex flex-col gap-2 bg-surface-container-low px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-headline text-xl font-black text-primary">{getMetricDefinition(snapshot.request.metricId)?.displayName}</h2>
        <p className="font-mono text-xs text-on-surface-variant">{snapshot.methodVersion} · {snapshot.formulaVersion}</p>
      </div>
      <div className="divide-y divide-surface-container">
        {snapshot.entries.map((entry) => (
          <article key={entry.entity.id} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 px-4 py-5 sm:grid-cols-[4rem_1fr_8rem_8rem_7rem] sm:px-6">
            <p className="font-headline text-2xl font-black text-primary">{String(entry.rank).padStart(2, '0')}</p>
            <div className="min-w-0">
              <Link prefetch={false} href={`/player/${entry.entity.id}?edition=${encodeURIComponent(snapshot.request.competitionId)}`} className="font-headline text-lg font-bold text-primary hover:text-secondary">{entry.entity.name}</Link>
              <p className="truncate text-xs text-on-surface-variant">{entry.entity.position} · {entry.entity.teamName} · {ordinal(entry.percentile)} percentile</p>
              <p className="mt-1 text-xs text-on-surface-variant sm:hidden">{entry.result.games} games · {entry.result.minutes.toFixed(0)} min · {entry.result.coverage.toLocaleLowerCase()}</p>
            </div>
            <p className="text-right font-headline text-2xl font-black text-secondary">{valueLabel(entry.result)}</p>
            <p className="hidden text-right text-sm text-on-surface-variant sm:block">{entry.result.games} games<br />{entry.result.minutes.toFixed(0)} min</p>
            <p className="hidden text-right font-label text-xs font-bold text-on-surface-variant sm:block">{entry.movementLabel}<br />{entry.result.coverage}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function TeamPowerTable({ snapshot }: { snapshot: Awaited<ReturnType<typeof getTeamPowerSnapshot>> }) {
  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl">
        <div className="flex flex-col gap-2 bg-surface-container-low px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-headline text-xl font-black text-primary">CentrePass Team Power</h2>
          <p className="font-mono text-xs text-on-surface-variant">{snapshot.methodVersion}</p>
        </div>
        <div className="divide-y divide-surface-container">
          {snapshot.entries.map((entry) => (
            <article key={entry.entity.id} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 px-4 py-5 sm:grid-cols-[4rem_1fr_8rem_8rem_7rem] sm:px-6">
              <p className="font-headline text-2xl font-black text-primary">{String(entry.rank).padStart(2, '0')}</p>
              <div>
                <Link prefetch={false} href={`/team/${entry.entity.slug}`} className="font-headline text-lg font-bold text-primary hover:text-secondary">{entry.entity.name}</Link>
                <p className="text-xs text-on-surface-variant">{entry.wins}-{entry.losses}-{entry.draws} · {ordinal(entry.percentile)} percentile</p>
                <p className="mt-1 text-xs text-on-surface-variant sm:hidden">{entry.games} games · {entry.includedMatchIds.length} included · {entry.coverage.toLocaleLowerCase()}</p>
              </div>
              <p className="text-right font-headline text-2xl font-black text-secondary">{entry.rating.toFixed(1)}</p>
              <p className="hidden text-right text-sm text-on-surface-variant sm:block">{entry.games} games<br />{entry.includedMatchIds.length} included</p>
              <p className="hidden text-right font-label text-xs font-bold text-on-surface-variant sm:block">{entry.movementLabel}<br />{entry.coverage}</p>
            </article>
          ))}
        </div>
      </div>
      <details className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 text-sm text-on-surface-variant">
        <summary className="cursor-pointer font-headline font-bold text-primary">Team power methodology</summary>
        <p className="mt-3 leading-relaxed">{TEAM_POWER_METHODOLOGY.description}</p>
        <p className="mt-2 font-mono text-xs">{TEAM_POWER_METHODOLOGY.version}</p>
      </details>
    </section>
  );
}
