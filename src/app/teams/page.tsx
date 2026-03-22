import { prisma } from '@/lib/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      abbreviation: true,
      logoUrl: true,
      primaryColor: true,
    },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="max-w-7xl mx-auto">
      <section className="mb-12">
        <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary uppercase">
          Teams
        </h1>
        <p className="text-on-surface-variant font-body mt-2">
          Suncorp Super Netball teams
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {teams.map((team) => (
          <Link
            key={team.id}
            href={`/team/${team.slug}`}
            className="bg-surface-container-lowest rounded-xl p-6 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-primary-container flex items-center justify-center">
                {team.logoUrl ? (
                  <img src={team.logoUrl} alt={team.name} className="w-14 h-14 object-contain" />
                ) : (
                  <span className="text-4xl font-black italic text-white font-headline">
                    {team.abbreviation.charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <h2 className="font-headline font-bold text-lg text-primary group-hover:text-secondary transition-colors">
                  {team.name}
                </h2>
                <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest mt-1">
                  {team.abbreviation}
                </p>
              </div>
              <span className="material-symbols-outlined text-outline-variant group-hover:text-secondary transition-colors">
                chevron_right
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
