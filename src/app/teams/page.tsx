import type { Metadata } from 'next';
import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { JsonLd, breadcrumbJsonLd } from '@/lib/seo';
import { getTeams } from '@/lib/cached-queries';
import { timedQuery } from '@/lib/server-timing';

export const metadata: Metadata = {
  title: 'All Teams - Suncorp Super Netball',
  description:
    'Browse all 8 Suncorp Super Netball teams — rosters, stats, and season performance.',
};

export default async function TeamsPage() {
  const teams = await timedQuery('team_directory', getTeams);

  return (
    <div className="max-w-7xl mx-auto">
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Teams', url: '/teams' },
      ])} />
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
            prefetch={false}
            className="bg-surface-container-lowest rounded-xl p-6 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center text-center gap-4">
              <TeamBadge team={team} size={56} variant="home" className="rounded-2xl" />
              <div>
                <h2 className="font-headline font-bold text-lg text-primary group-hover:text-secondary transition-colors">
                  {team.name}
                </h2>
                <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest mt-1">
                  {team.abbreviation}
                </p>
              </div>
              <span aria-hidden="true" className="material-symbols-outlined text-outline-variant group-hover:text-secondary transition-colors">
                chevron_right
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
