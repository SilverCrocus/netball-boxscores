import { prisma } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function StandingsPage() {
  const standings = await prisma.standing.findMany({
    include: {
      team: { select: { name: true, slug: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { rank: 'asc' },
  });

  return (
    <div className="max-w-7xl mx-auto">
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
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest">Rank</th>
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest">Team</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GP</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">W</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">L</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">D</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GF</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GA</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">G%</th>
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest text-right">Pts</th>
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
                        <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-white font-black text-xl italic font-headline shadow-inner">
                          {s.team.abbreviation.charAt(0)}
                        </div>
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
