import { prisma } from '@/lib/db';
import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { Metadata } from 'next';
import { JsonLd, breadcrumbJsonLd } from '@/lib/seo';

export const dynamic = 'force-dynamic';

// Column headers with hover tooltips, matching the dotted-underline pattern
// used on the live lineups / box-score tables (see LiveLineups.tsx).
const COLUMNS = [
  { label: 'Rank', tooltip: 'Rank — Current ladder position', align: 'left' as const, px: 'px-6' },
  { label: 'Team', tooltip: 'Team', align: 'left' as const, px: 'px-6' },
  { label: 'GP', tooltip: 'Games Played', align: 'center' as const, px: 'px-4' },
  { label: 'W', tooltip: 'Wins', align: 'center' as const, px: 'px-4' },
  { label: 'L', tooltip: 'Losses', align: 'center' as const, px: 'px-4' },
  { label: 'D', tooltip: 'Draws', align: 'center' as const, px: 'px-4' },
  { label: 'GF', tooltip: 'Goals For — Total goals scored', align: 'center' as const, px: 'px-4' },
  { label: 'GA', tooltip: 'Goals Against — Total goals conceded', align: 'center' as const, px: 'px-4' },
  { label: 'G%', tooltip: 'Goal Percentage — Goals for ÷ goals against × 100 (ladder tiebreaker)', align: 'center' as const, px: 'px-4' },
  { label: 'Pts', tooltip: 'Points — 4 for a win, 2 for a draw, 0 for a loss', align: 'right' as const, px: 'px-6' },
];

const DOTTED_UNDERLINE = {
  textDecoration: 'underline dotted rgba(67,71,78,0.4)',
  textUnderlineOffset: '3px',
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const year = new Date().getFullYear();
  return {
    title: `${year} SSN Standings`,
    description: `Current Suncorp Super Netball standings and ladder for the ${year} season.`,
  };
}

export default async function StandingsPage() {
  const standings = await prisma.standing.findMany({
    include: {
      team: { select: { name: true, slug: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { rank: 'asc' },
  });

  return (
    <div className="max-w-7xl mx-auto">
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Standings', url: '/standings' },
      ])} />

      {/* Header */}
      <section className="mb-12 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <span className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-xs font-bold font-label uppercase tracking-widest mb-4">
            <span className="w-2 h-2 bg-secondary rounded-full animate-pulse" />
            Season 2026
          </span>
          <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary uppercase leading-none">
            League <span className="text-on-tertiary-container">Standings</span>
          </h1>
        </div>
      </section>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-2xl mb-8">
        <div className="kinetic-gradient p-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-secondary-fixed">leaderboard</span>
            <h3 className="text-white font-headline font-bold text-lg uppercase tracking-tight">
              Current Rankings
            </h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant">
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    title={col.tooltip}
                    style={DOTTED_UNDERLINE}
                    className={`py-5 ${col.px} font-label text-xs font-bold uppercase tracking-widest cursor-help ${
                      col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {standings.map((s) => {
                const isTop = s.rank <= 2;
                return (
                  <tr key={s.id} className="group hover:bg-surface transition-colors relative">
                    <td className="py-6 px-6 relative">
                      {isTop && (
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.rank === 1 ? 'bg-secondary shadow-[0_0_12px_rgba(0,110,10,0.5)]' : 'bg-secondary/60'}`} />
                      )}
                      <span className="text-2xl font-black font-headline text-primary">
                        {String(s.rank).padStart(2, '0')}
                      </span>
                    </td>
                    <td className="py-6 px-6">
                      <Link href={`/team/${s.team.slug}`} className="flex items-center gap-4">
                        <TeamBadge team={s.team} size={48} variant="home" className="shadow-inner" />
                        <div className="font-headline font-bold text-primary text-lg leading-tight">
                          {s.team.name}
                        </div>
                      </Link>
                    </td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-primary">{s.played}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-secondary">{s.wins}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-error">{s.losses}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-on-surface-variant">{s.draws}</td>
                    <td className="py-6 px-4 text-center font-label text-primary">{s.goalsFor}</td>
                    <td className="py-6 px-4 text-center font-label text-primary">{s.goalsAgainst}</td>
                    <td className="py-6 px-4 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-bold font-headline ${isTop ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}`}>
                        {s.goalPercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-6 px-6 text-right font-black font-headline text-2xl text-primary tracking-tighter">
                      {s.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
