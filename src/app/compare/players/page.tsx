import type { Metadata } from 'next';
import Link from 'next/link';
import type { MetricAggregation, MetricResult } from '@/lib/analytics';
import { getPublicCompetitions } from '@/lib/competitions';
import { getComparisonPlayers, getPlayerComparison } from '@/lib/comparison/service';
import { GroupedPlayerOptions } from './GroupedPlayerOptions';

export const metadata: Metadata = {
  title: 'Compare Netball Players',
  description: 'Compare player totals, per-game and per-60 metrics with position percentiles and transparent samples.',
};

interface ComparePageProps {
  searchParams: Promise<{ edition?: string; left?: string; right?: string; mode?: string; lastN?: string }>;
}

const MODES: MetricAggregation[] = ['TOTAL', 'PER_GAME', 'PER_60'];
const METRICS = ['goals', 'goal_assists', 'defensive_activity', 'turnovers', 'penalties'];

function value(result: MetricResult): string {
  if (result.value === null) return '—';
  if (result.unit === 'PERCENT') return `${result.value.toFixed(1)}%`;
  return result.value.toFixed(1);
}

function percentile(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : rounded % 10 === 1 ? 'st' : rounded % 10 === 2 ? 'nd' : rounded % 10 === 3 ? 'rd' : 'th';
  return `${rounded}${suffix}`;
}

export default async function ComparePlayersPage({ searchParams }: ComparePageProps) {
  const query = await searchParams;
  const editions = await getPublicCompetitions();
  const edition = editions.find((option) => option.id === query.edition || option.slug === query.edition) ?? editions[0] ?? null;
  const players = edition ? await getComparisonPlayers(edition.id) : [];
  const left = players.find((player) => player.id === query.left) ?? players[0];
  const right = players.find((player) => player.id === query.right && player.id !== left?.id) ?? players.find((player) => player.id !== left?.id);
  const mode = MODES.includes(query.mode as MetricAggregation) ? query.mode as MetricAggregation : 'PER_60';
  const parsedLastN = Number(query.lastN);
  const lastN = query.lastN && Number.isInteger(parsedLastN) && parsedLastN >= 1 && parsedLastN <= 100 ? parsedLastN : undefined;
  const comparison = edition && left && right
    ? await getPlayerComparison({
      leftPlayerId: left.id, rightPlayerId: right.id,
      leftCompetitionId: edition.id, rightCompetitionId: edition.id,
      aggregation: mode, metricIds: METRICS, lastN,
    })
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="rounded-3xl bg-primary-container px-6 py-9 text-white shadow-xl sm:px-10 sm:py-12">
        <p className="font-label text-xs font-bold uppercase tracking-[0.22em] text-lime-300">Side by side, with context</p>
        <h1 className="mt-3 font-headline text-4xl font-black tracking-tight sm:text-6xl">Compare Players</h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">Raw values never stand alone: compare position percentiles, games, minutes, coverage, formulas, and the exact matches included.</p>
      </header>

      <form method="get" className="grid gap-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm md:grid-cols-2 xl:grid-cols-5">
        <Filter label="Edition"><select name="edition" defaultValue={edition?.id} className="filter-control">{editions.map((option) => <option key={option.id} value={option.id}>{option.series?.name ?? option.name} · {option.label ?? option.season}</option>)}</select></Filter>
        <Filter label="Player one"><select name="left" defaultValue={left?.id} className="filter-control"><GroupedPlayerOptions players={players} /></select></Filter>
        <Filter label="Player two"><select name="right" defaultValue={right?.id} className="filter-control"><GroupedPlayerOptions players={players} /></select></Filter>
        <Filter label="Mode"><select name="mode" defaultValue={mode} className="filter-control">{MODES.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ').toLocaleLowerCase()}</option>)}</select></Filter>
        <Filter label="Window"><select name="lastN" defaultValue={lastN ?? ''} className="filter-control"><option value="">Whole edition</option>{[3, 5, 10, 20].map((option) => <option key={option} value={option}>Last {option}</option>)}</select></Filter>
        <button type="submit" className="min-h-11 rounded-xl bg-secondary px-5 font-headline text-sm font-bold text-white xl:col-start-5">Compare</button>
      </form>

      {!comparison || comparison.metrics.length === 0 ? (
        <section className="rounded-2xl bg-surface-container-lowest px-6 py-14 text-center shadow-sm"><h2 className="font-headline text-2xl font-black text-primary">No compatible comparison</h2><p className="mt-2 text-on-surface-variant">Choose two different players with covered statistics for this mode and window.</p></section>
      ) : (
        <>
          {comparison.warnings.map((warning) => <p key={warning} role="note" className="rounded-xl border border-amber-400/40 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{warning}</p>)}
          <section className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-surface-container-lowest p-5 shadow-sm sm:gap-8 sm:p-8">
            <PlayerHeader player={comparison.leftPlayer} align="left" />
            <p className="font-label text-xs font-black uppercase tracking-[0.2em] text-on-surface-variant">vs</p>
            <PlayerHeader player={comparison.rightPlayer} align="right" />
          </section>

          {comparison.crossPosition && <p className="rounded-xl bg-secondary-container px-4 py-3 text-center text-sm font-bold text-on-secondary-container">Different positions: position percentiles lead each comparison; raw totals are secondary.</p>}

          <section className="space-y-4" aria-label="Comparison metrics">
            {comparison.metrics.map((metric) => (
              <article key={metric.metricId} className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm sm:p-7">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-8">
                  <MetricValue side={metric.left} leadWithPercentile={comparison.leadWithPercentiles} align="left" />
                  <div className="max-w-40 text-center"><h2 className="font-headline text-sm font-black text-primary sm:text-lg">{metric.displayName}</h2><p className="mt-1 hidden font-mono text-[10px] text-on-surface-variant sm:block">{metric.formulaVersion}</p></div>
                  <MetricValue side={metric.right} leadWithPercentile={comparison.leadWithPercentiles} align="right" />
                </div>
                <details className="mt-5 border-t border-outline-variant pt-4 text-xs text-on-surface-variant"><summary className="cursor-pointer font-bold text-secondary">Definition and included matches</summary><p className="mt-2">{metric.definition}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><IncludedMatches label={comparison.leftPlayer.name} result={metric.left.result} /><IncludedMatches label={comparison.rightPlayer.name} result={metric.right.result} /></div></details>
              </article>
            ))}
          </section>

          <footer className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 text-xs text-on-surface-variant">
            <p>{comparison.version} · as of {comparison.asOf ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(comparison.asOf)) : 'unavailable'}</p>
            <p className="mt-1">Coverage: {comparison.leftPlayer.name} {comparison.coverage.left.toLocaleLowerCase()} · {comparison.rightPlayer.name} {comparison.coverage.right.toLocaleLowerCase()}</p>
          </footer>
        </>
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant">{label}{children}</label>; }

function PlayerHeader({ player, align }: { player: { id: string; name: string; position: string; teamName: string }; align: 'left' | 'right' }) {
  return <div className={align === 'right' ? 'text-right' : ''}><Link href={`/player/${player.id}`} className="font-headline text-lg font-black text-primary hover:text-secondary sm:text-2xl">{player.name}</Link><p className="mt-1 text-xs text-on-surface-variant sm:text-sm">{player.position} · {player.teamName}</p></div>;
}

function MetricValue({ side, leadWithPercentile, align }: { side: { result: MetricResult; positionPercentile: number | null }; leadWithPercentile: boolean; align: 'left' | 'right' }) {
  return <div className={align === 'right' ? 'text-right' : ''}>{leadWithPercentile && <p className="font-headline text-3xl font-black text-secondary sm:text-4xl">{percentile(side.positionPercentile)}</p>}<p className={`${leadWithPercentile ? 'mt-1 text-sm' : 'font-headline text-3xl font-black sm:text-4xl'} text-primary`}>{value(side.result)}{leadWithPercentile ? ` · ${side.result.aggregation.toLocaleLowerCase().replaceAll('_', ' ')}` : ''}</p><p className="mt-1 text-[11px] text-on-surface-variant">{side.result.games} games · {side.result.minutes.toFixed(0)} min</p></div>;
}

function IncludedMatches({ label, result }: { label: string; result: MetricResult }) {
  return <div><p className="font-bold text-primary">{label}</p><p>{result.games} games · {result.minutes.toFixed(0)} minutes · {result.coverage.toLocaleLowerCase()}</p><div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">{result.includedMatchIds.map((matchId, index) => <Link key={matchId} href={`/match/${matchId}`} className="font-mono text-secondary underline">Game {index + 1}</Link>)}</div></div>;
}
