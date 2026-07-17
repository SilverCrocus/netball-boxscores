import type { Metadata } from 'next';
import Link from 'next/link';
import { getMetricDefinition, metricCatalogue } from '@/lib/analytics';
import type { AnalyticsEntityType, MetricAggregation } from '@/lib/analytics';
import { getPublicCompetitions } from '@/lib/competitions';
import { getRecordSnapshot } from '@/lib/records/service';
import type { RecordScope } from '@/lib/records';
import { editionScopedHref, matchHref } from '@/lib/edition-links';

export const metadata: Metadata = {
  title: 'Netball Records',
  description: 'Coverage-labelled netball records with formula, source, scope, and supporting-match evidence.',
};

interface RecordsPageProps {
  searchParams: Promise<{ edition?: string; scope?: string; metric?: string; entity?: string; aggregation?: string }>;
}

const SCOPES: Array<{ value: RecordScope; label: string }> = [
  { value: 'SINGLE_MATCH', label: 'Single match' },
  { value: 'EDITION', label: 'Edition' },
  { value: 'FINALS', label: 'Finals' },
  { value: 'CAREER', label: 'Covered career' },
  { value: 'TEAM', label: 'Team edition' },
  { value: 'CENTREPASS_ERA', label: 'CentrePass era' },
];

function scopeValue(value?: string): RecordScope {
  return SCOPES.some((scope) => scope.value === value) ? value as RecordScope : 'SINGLE_MATCH';
}

function formatValue(value: number, unit: string): string {
  if (unit === 'PERCENT') return `${value.toFixed(1)}%`;
  return Number.isInteger(value) ? value.toLocaleString('en-AU') : value.toFixed(1);
}

export default async function RecordsPage({ searchParams }: RecordsPageProps) {
  const query = await searchParams;
  const scope = scopeValue(query.scope);
  const entityType: AnalyticsEntityType = scope === 'TEAM' || query.entity === 'TEAM' ? 'TEAM' : 'PLAYER';
  const editions = await getPublicCompetitions();
  const edition = editions.find((option) => option.id === query.edition || option.slug === query.edition) ?? editions[0] ?? null;
  const availableMetrics = metricCatalogue.filter((definition) =>
    definition.entityTypes.includes(entityType) && definition.calculation.kind !== 'SERVICE',
  );
  const requestedMetric = getMetricDefinition(query.metric ?? 'goals');
  const metric = requestedMetric && availableMetrics.some((option) => option.id === requestedMetric.id)
    ? requestedMetric
    : availableMetrics[0];
  const requestedAggregation = query.aggregation as MetricAggregation | undefined;
  const aggregation = metric && requestedAggregation && metric.allowedAggregations.includes(requestedAggregation)
    ? requestedAggregation
    : metric?.defaultAggregation ?? 'TOTAL';
  const snapshot = metric && (edition || scope === 'CAREER' || scope === 'CENTREPASS_ERA')
    ? await getRecordSnapshot({
      scope,
      metricId: metric.id,
      aggregation,
      entityType,
      competitionId: edition?.id,
      limit: 25,
    })
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="rounded-3xl bg-primary-container px-6 py-9 text-white shadow-xl sm:px-10 sm:py-12">
        <p className="font-label text-xs font-bold uppercase tracking-[0.22em] text-lime-300">Auditable, not overstated</p>
        <h1 className="mt-3 font-headline text-4xl font-black tracking-tight sm:text-6xl">CentrePass Records</h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
          Records are limited to verified CentrePass coverage. Each entry keeps its scope, source policy, formula version, date, and supporting matches visible.
        </p>
      </header>

      <form method="get" className="grid gap-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm md:grid-cols-2 xl:grid-cols-5">
        <Filter label="Scope"><select name="scope" defaultValue={scope} className="filter-control">{SCOPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Filter>
        <Filter label="Edition"><select name="edition" defaultValue={edition?.id} className="filter-control">{editions.map((option) => <option key={option.id} value={option.id}>{option.series?.name ?? option.name} · {option.label ?? option.season}</option>)}</select></Filter>
        {scope !== 'TEAM' && <Filter label="Subject"><select name="entity" defaultValue={entityType} className="filter-control"><option value="PLAYER">Players</option><option value="TEAM">Teams</option></select></Filter>}
        <Filter label="Metric"><select name="metric" defaultValue={metric?.id} className="filter-control">{availableMetrics.map((option) => <option key={option.id} value={option.id}>{option.displayName}</option>)}</select></Filter>
        <Filter label="Mode"><select name="aggregation" defaultValue={aggregation} className="filter-control">{metric?.allowedAggregations.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ').toLocaleLowerCase()}</option>)}</select></Filter>
        <button className="min-h-11 rounded-xl bg-secondary px-5 font-headline text-sm font-bold text-white xl:col-start-5" type="submit">Update records</button>
      </form>

      {!snapshot || snapshot.entries.length === 0 ? (
        <section className="rounded-2xl bg-surface-container-lowest px-6 py-14 text-center shadow-sm">
          <h2 className="font-headline text-2xl font-black text-primary">No eligible records</h2>
          <p className="mt-2 text-on-surface-variant">No official, covered results support this scope and metric yet.</p>
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Record coverage details">
            <AuditCard label="Coverage claim" value={snapshot.coverageLabel} />
            <AuditCard label="Formula" value={`${snapshot.methodVersion} · ${snapshot.entries[0].formulaVersion}`} />
            <AuditCard label="As of" value={snapshot.asOf ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(snapshot.asOf)) : '—'} />
          </section>
          <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl">
            <div className="flex flex-col gap-2 bg-surface-container-low px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-headline text-xl font-black text-primary">{metric?.displayName} · {SCOPES.find((option) => option.value === scope)?.label}</h2>
              <p className="font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">{snapshot.entries.length} recorded results</p>
            </div>
            <div className="divide-y divide-surface-container">
              {snapshot.entries.map((entry, index) => (
                <article key={`${entry.entity.id}-${entry.supportingMatchId ?? 'aggregate'}`} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 px-4 py-5 sm:grid-cols-[4rem_1fr_9rem_10rem] sm:px-6">
                  <p className="font-headline text-2xl font-black text-primary">{String(index + 1).padStart(2, '0')}</p>
                  <div className="min-w-0">
                    <Link href={editionScopedHref(entry.entityType === 'PLAYER' ? `/player/${entry.entity.id}` : `/team/${entry.entity.slug}`, entry.supportingCompetitionId ?? edition?.id)} className="font-headline text-lg font-bold text-primary hover:text-secondary">{entry.entity.name}</Link>
                    <p className="truncate text-xs text-on-surface-variant">{entry.entity.position ? `${entry.entity.position} · ` : ''}{entry.entity.teamName ?? entry.coverageLabel}</p>
                    <p className="mt-1 text-xs text-on-surface-variant sm:hidden">{entry.games} games · {entry.minutes.toFixed(0)} min · {entry.status.toLocaleLowerCase()}</p>
                  </div>
                  <p className="text-right font-headline text-2xl font-black text-secondary">{formatValue(entry.value, entry.unit)}</p>
                  <div className="hidden text-right text-xs text-on-surface-variant sm:block">
                    <p>{entry.games} games · {entry.minutes.toFixed(0)} min</p>
                    <p>{new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(entry.achievedAt))}</p>
                    {entry.supportingMatchId && entry.supportingCompetitionId && <Link href={matchHref(entry.supportingMatchId, entry.supportingCompetitionId)} className="font-bold text-secondary">Supporting match</Link>}
                    <p className="font-mono">{entry.status.toLocaleLowerCase()}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <details className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 text-sm text-on-surface-variant">
            <summary className="cursor-pointer font-headline font-bold text-primary">Source and coverage policy</summary>
            <p className="mt-3">{snapshot.entries[0].source.policy}. {snapshot.entries[0].source.note}</p>
            <p className="mt-2">Corrected records create a new corrected entry and supersede the previous value; prior history is retained.</p>
          </details>
        </>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">{label}{children}</label>;
}

function AuditCard({ label, value }: { label: string; value: string }) {
  return <article className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm"><p className="font-label text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p><p className="mt-2 font-headline text-base font-bold text-primary">{value}</p></article>;
}
