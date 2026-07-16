import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { secondaryPlayerPhotoUrl } from '@/lib/player-photo';
import { formatMatchDate, formatMatchTime, formatShortDate } from '@/lib/format';
import { JsonLd, sportsTeamJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import { getPublicCompetitions, type CompetitionOption } from '@/lib/competitions';
import { toEditionContext } from '@/lib/edition-context';
import { editionHref, editionScopedHref } from '@/lib/edition-links';
import { countryFlagForTeam } from '@/lib/country-flags';
import {
  getRecentTeamMatches,
  getTeamEditionRoster,
  getTeamBySlug,
  getTeamStanding,
  getUpcomingTeamMatches,
} from '@/lib/cached-queries';
import { timedQuery } from '@/lib/server-timing';

interface TeamPageProps {
  params: Promise<{ teamSlug: string }>;
  searchParams?: Promise<{ edition?: string; competition?: string; season?: string }>;
}

type TeamWithEditions = NonNullable<Awaited<ReturnType<typeof getTeamBySlug>>>;

function teamBelongsToEdition(
  team: TeamWithEditions,
  competition: CompetitionOption,
): boolean {
  const hasActiveEditionEntry = team.editionEntries.some(
    (entry) => entry.competitionId === competition.id,
  );
  const hasLegacyLeagueMembership = competition.series?.kind === 'LEAGUE'
    && team.competitionId === competition.id;

  return hasActiveEditionEntry || hasLegacyLeagueMembership;
}

function selectTeamCompetition(
  team: TeamWithEditions,
  competitions: readonly CompetitionOption[],
  selection: { edition?: string; competition?: string; season?: string },
): CompetitionOption | null {
  const teamCompetitions = competitions.filter((competition) =>
    teamBelongsToEdition(team, competition),
  );

  if (selection.edition) {
    let selected: CompetitionOption | undefined;

    if (selection.competition) {
      const qualifiedMatches = competitions.filter((competition) =>
        competition.series?.slug === selection.competition
          && (competition.id === selection.edition || competition.slug === selection.edition),
      );
      selected = qualifiedMatches.length === 1 ? qualifiedMatches[0] : undefined;
    } else {
      const routeParts = selection.edition.split('/');
      if (routeParts.length === 2 && routeParts.every(Boolean)) {
        const [competitionSlug, editionSlug] = routeParts;
        const qualifiedMatches = competitions.filter((competition) =>
          competition.series?.slug === competitionSlug && competition.slug === editionSlug,
        );
        selected = qualifiedMatches.length === 1 ? qualifiedMatches[0] : undefined;
      } else {
        selected = competitions.find((competition) => competition.id === selection.edition);
        if (!selected) {
          const slugMatches = competitions.filter(
            (competition) => competition.slug === selection.edition,
          );
          selected = slugMatches.length === 1 ? slugMatches[0] : undefined;
        }
      }
    }

    return selected && teamBelongsToEdition(team, selected) ? selected : null;
  }

  if (selection.competition) return null;

  if (selection.season) {
    if (!/^\d{4}$/.test(selection.season)) return null;
    const leagueMatches = teamCompetitions.filter((competition) =>
      competition.series?.kind === 'LEAGUE'
        && competition.season.toString() === selection.season,
    );
    return leagueMatches.length === 1 ? leagueMatches[0] : null;
  }

  return teamCompetitions[0] ?? null;
}

export async function generateMetadata({ params }: TeamPageProps): Promise<Metadata> {
  const { teamSlug } = await params;
  const team = await getTeamBySlug(teamSlug);

  if (!team) return { title: 'Team Not Found' };

  return {
    title: `${team.name} - Roster & Stats`,
    description: `${team.name} roster, season stats, and recent results in the ${new Date().getFullYear()} Suncorp Super Netball season.`,
  };
}

export default async function TeamPage({ params, searchParams = Promise.resolve({}) }: TeamPageProps) {
  const { teamSlug } = await params;
  const { edition, competition: competitionSlug, season } = await searchParams;

  const [team, competitions] = await Promise.all([
    timedQuery('team_profile', () => getTeamBySlug(teamSlug)),
    timedQuery('competition_lookup', () => getPublicCompetitions()),
  ]);

  if (!team) notFound();
  const competition = selectTeamCompetition(team, competitions, {
    edition,
    competition: competitionSlug,
    season,
  });
  if (!competition) notFound();

  if (edition !== competition.id) {
    redirect(
      `/team/${encodeURIComponent(teamSlug)}?edition=${encodeURIComponent(competition.id)}`,
    );
  }

  const teamsHref = competition?.series && competition.slug
    ? editionHref(toEditionContext(competition), 'teams')
    : '/teams';

  const standingPromise = competition
    ? timedQuery('team_standing', () => getTeamStanding(competition.id, team.id))
    : Promise.resolve(null);
  const rosterPromise = competition
    ? timedQuery('team_edition_roster', () => getTeamEditionRoster(competition.id, team.id))
    : Promise.resolve([]);
  const [standing, recentMatches, upcomingMatches, editionRoster] = await Promise.all([
    standingPromise,
    competition
      ? timedQuery('team_recent_matches', () => getRecentTeamMatches(competition.id, team.id))
      : Promise.resolve([]),
    competition
      ? timedQuery('team_upcoming_matches', () => getUpcomingTeamMatches(competition.id, team.id))
      : Promise.resolve([]),
    rosterPromise,
  ]);
  const profilePlayers = editionRoster.length > 0
    ? editionRoster.map((membership) => ({
        ...membership.player,
        position: membership.designatedPosition ?? membership.player.position,
      }))
    : competition.id === team.competitionId
      ? team.players
      : [];
  const withOpponent = (match: (typeof recentMatches)[number]) => {
    const isHome = match.homeTeamId === team.id;
    const opponentTeam = isHome ? match.awayTeam : match.homeTeam;
    return { ...match, isHome, opponent: opponentTeam.name, opponentTeam };
  };
  const recentResults = recentMatches.map(withOpponent);
  const upcoming = upcomingMatches.map(withOpponent);
  const teamCountryFlag = countryFlagForTeam(team);

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      <JsonLd data={sportsTeamJsonLd({
        name: team.name,
        slug: team.slug,
        logoUrl: team.logoUrl,
      })} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Teams', url: teamsHref },
        {
          name: team.name,
          url: editionScopedHref(`/team/${team.slug}`, competition.id),
        },
      ])} />
      {/* Hero */}
      <section className="kinetic-gradient relative flex min-h-[400px] items-center overflow-hidden rounded-xl p-4 text-white shadow-2xl sm:p-8 md:p-12">
        <div className="relative z-10 grid w-full min-w-0 items-center gap-8 md:grid-cols-2 md:gap-12">
          <div className="flex min-w-0 flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-8">
            <div
              className="flex h-28 w-28 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 bg-white/10 shadow-inner backdrop-blur-xl sm:h-32 sm:w-32 md:h-48 md:w-48"
              style={{ borderColor: team.primaryColor || '#a3e635' }}
            >
              {team.logoUrl ? (
                <Image
                  src={team.logoUrl}
                  alt={team.name}
                  width={192}
                  height={192}
                  className="w-full h-full object-contain p-4"
                />
              ) : teamCountryFlag ? (
                <Image
                  src={teamCountryFlag}
                  alt={`${team.name} flag`}
                  width={192}
                  height={144}
                  unoptimized
                  className="h-auto w-full object-contain p-2 sm:p-3 md:p-4"
                />
              ) : (
                <span
                  className="font-headline font-black text-7xl md:text-9xl italic tracking-tighter"
                  style={{ color: team.primaryColor || '#a3e635' }}
                >
                  {team.abbreviation.charAt(0)}
                </span>
              )}
            </div>
            <div className="min-w-0 max-w-full">
              {standing && (
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-secondary text-white font-label text-xs font-bold tracking-widest uppercase mb-4">
                  League Ranking #{standing.rank}
                </div>
              )}
              <h1 className="mb-4 max-w-full font-headline text-[clamp(2.25rem,6vw,4.5rem)] font-black italic leading-[0.95] uppercase break-words [overflow-wrap:anywhere]">
                {team.name}
              </h1>
            </div>
          </div>
          {standing && (
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:gap-4">
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Record</span>
                <span className="font-headline font-bold text-4xl text-white">
                  {standing.wins}-{standing.losses}-{standing.draws}
                </span>
              </div>
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Points</span>
                <span className="font-headline font-bold text-4xl" style={{ color: team.primaryColor || '#a3e635' }}>{standing.points}</span>
              </div>
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goals For</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalsFor}</span>
              </div>
              <div className="min-w-0 rounded-xl border-l-4 bg-white/5 p-4 backdrop-blur-md sm:p-6" style={{ borderLeftColor: team.primaryColor || '#a3e635' }}>
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goals Against</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalsAgainst}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent Form */}
      {recentResults.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-headline font-bold text-2xl text-primary flex items-center gap-3">
              <span className="w-1 h-8 bg-secondary rounded-full" />
              Recent Form
            </h2>
            <span className="font-label text-on-surface-variant text-sm font-semibold">Last 5 Games</span>
          </div>
          <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2" aria-label="Recent team form">
            {recentResults.map((m) => {
              const teamScore = m.isHome ? m.homeScore : m.awayScore;
              const oppScore = m.isHome ? m.awayScore : m.homeScore;
              const won = teamScore > oppScore;
              const drawn = teamScore === oppScore;
              const result = drawn ? 'D' : won ? 'W' : 'L';
              const borderColor = drawn ? 'border-outline-variant' : won ? 'border-secondary' : 'border-error';
              const badgeColor = drawn ? 'bg-outline-variant' : won ? 'bg-secondary' : 'bg-error';
              return (
                <Link
                  key={m.id}
                  href={editionScopedHref(`/match/${m.id}`, competition.id)}
                  prefetch={false}
                  className={`flex-shrink-0 snap-start flex items-center gap-3 px-6 py-4 bg-surface-container-lowest rounded-xl shadow-sm border-b-2 ${
                    borderColor
                  }`}
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${badgeColor}`}>
                    {result}
                  </span>
                  <TeamBadge team={m.opponentTeam} size={32} variant="away" />
                  <div>
                    <p className="font-headline font-bold text-sm">vs {m.opponent}</p>
                    <p className="font-label text-xs text-on-surface-variant">
                      {teamScore} - {oppScore}
                      {' \u2022 '}
                      {formatMatchDate(m.scheduledAt)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Roster + Upcoming */}
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Full Roster</h2>
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-high border-b border-outline-variant">
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Player</th>
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Pos</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {profilePlayers.map((player) => (
                  <tr key={player.id} className="hover:bg-surface-container-low transition-colors cursor-pointer group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <PlayerAvatar
                          decorative
                          name={player.name}
                          photoUrl={secondaryPlayerPhotoUrl(player)}
                          size={40}
                          className="rounded"
                        />
                        <Link
                          prefetch={false}
                          href={`/player/${player.id}${competition ? `?edition=${encodeURIComponent(competition.id)}` : ''}`}
                          className="font-body font-bold text-primary hover:text-secondary transition-colors"
                        >
                          {player.name}
                        </Link>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="bg-primary-container text-primary-fixed-dim px-2 py-1 rounded text-xs font-black font-label">
                        {player.position}
                      </span>
                    </td>
                    <td className="p-4 w-12">
                      <span aria-hidden="true" className="material-symbols-outlined text-xl text-outline-variant transition-colors group-hover:text-secondary">
                        chevron_right
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Upcoming Fixtures</h2>
          <div className="space-y-4">
            {upcoming.length === 0 && (
              <p className="text-on-surface-variant font-body text-sm">No upcoming fixtures</p>
            )}
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={editionScopedHref(`/match/${m.id}`, competition.id)}
                prefetch={false}
                className="block bg-surface-container-lowest p-5 rounded-xl border-l-4 border-secondary shadow-sm"
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <TeamBadge team={m.opponentTeam} size={36} variant="away" />
                    <div>
                      <p className="font-label text-xs font-black text-secondary uppercase tracking-widest">
                        {m.isHome ? 'Home' : 'Away'}
                      </p>
                      <p className="font-headline font-bold text-lg mt-1">vs {m.opponent}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-label text-xs font-bold text-on-surface-variant">
                      {formatShortDate(m.scheduledAt)}
                    </p>
                    <p className="font-body font-black text-primary">
                      {formatMatchTime(m.scheduledAt)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
