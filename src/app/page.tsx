import { MyTeams } from '@/components/home/MyTeams';
import {
  HomeScoreStrip,
  type HomeScoreStripItem,
} from '@/components/home/landing/HomeScoreStrip';
import { HomeRecentResults } from '@/components/home/landing/HomeRecentResults';
import {
  HomeStandingsPreview,
  type HomeStandingRow,
} from '@/components/home/landing/HomeStandingsPreview';
import {
  HomeUpcomingFixtures,
  type HomeUpcomingFixture,
} from '@/components/home/landing/HomeUpcomingFixtures';
import { LandingHero } from '@/components/home/landing/LandingHero';
import { getStandingsForCompetition } from '@/lib/cached-queries';
import {
  resolveCompetition,
  type CompetitionOption,
} from '@/lib/competitions';
import { prisma, excludeSimData } from '@/lib/db';
import { hasResolvedMatchTeams } from '@/lib/edition-match';
import { toEditionContext, type EditionContextValue } from '@/lib/edition-context';
import { editionHref, matchHref } from '@/lib/edition-links';
import {
  getCompletedMatchesPage,
  homepageMatchSelect,
  isHomepageScoreAvailable,
  type HomeResultCard,
  type ResolvedHomepageMatch,
} from '@/lib/home-feed';
import { formatMatchStage } from '@/lib/match-label';
import { JsonLd, websiteJsonLd, breadcrumbJsonLd } from '@/lib/seo';
import { timedQuery } from '@/lib/server-timing';
import {
  buildGlasgowHomepagePreview,
  type GlasgowHomepagePreview,
} from '@/lib/glasgow/home-preview';
import {
  glasgowUpstreamResultsParams,
  isUpstreamPreviewMode,
  loadUpstreamCompletedMatches,
} from '@/lib/upstream-preview';

export const dynamic = 'force-dynamic';

const HOME_LIVE_MATCH_LIMIT = 16;
const HOME_UPCOMING_MATCH_LIMIT = 5;
const DEFAULT_TIMEZONE = 'Australia/Sydney';

type LeagueStanding = Awaited<ReturnType<typeof getStandingsForCompetition>>[number];

function editionTimezone(competition: CompetitionOption | null): string {
  return competition?.sourceTimezone || DEFAULT_TIMEZONE;
}

function formatDateLabel(value: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: timezone,
  }).format(new Date(value)).replace(',', '').toUpperCase();
}

function formatTimeLabel(value: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(new Date(value)).toUpperCase();
}

function formatScoreDate(value: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(value)).replace(',', '').toUpperCase();
}

function compactStageLabel(label: string): string {
  return label.split(' — ')[0]?.trim() || label;
}

function timezoneNote(value: Date | string | undefined, timezone: string): string {
  if (!value) return `Times shown in ${timezone}`;
  const zoneName = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    timeZoneName: 'short',
  }).formatToParts(new Date(value)).find((part) => part.type === 'timeZoneName')?.value;
  return `All times shown in ${zoneName ?? timezone}`;
}

function liveScoreItem(
  match: ResolvedHomepageMatch,
  timezone: string,
): HomeScoreStripItem {
  const scoreAvailable = isHomepageScoreAvailable(match);
  const stage = compactStageLabel(formatMatchStage(
    match.round,
    match.finalCode,
    match.roundLabel,
    match.stage?.name,
  ));
  const clock = [
    match.currentQuarter ? `Q${match.currentQuarter}` : null,
    match.currentTime,
  ].filter(Boolean).join(' ');

  return {
    id: match.id,
    href: matchHref(match.id, match.competitionId),
    meta: ['LIVE', clock || formatScoreDate(match.scheduledAt, timezone), stage]
      .filter(Boolean)
      .join(' · '),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: scoreAvailable ? match.homeScore : null,
    awayScore: scoreAvailable ? match.awayScore : null,
  };
}

function completedScoreItem(
  match: HomeResultCard,
  timezone: string,
): HomeScoreStripItem {
  const stage = compactStageLabel(formatMatchStage(
    match.round,
    match.finalCode,
    match.roundLabel,
    match.stageName,
  ));

  return {
    id: match.id,
    href: match.href
      ?? (match.competitionId
        ? matchHref(match.id, match.competitionId)
        : `/match/${encodeURIComponent(match.id)}`),
    meta: `${formatScoreDate(match.scheduledAt, timezone)} · ${stage}`,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: match.scoreAvailable ? match.homeScore : null,
    awayScore: match.scoreAvailable ? match.awayScore : null,
  };
}

function buildScoreStripItems(
  liveMatches: ResolvedHomepageMatch[],
  completedGroups: Awaited<ReturnType<typeof getCompletedMatchesPage>>['groups'],
  timezone: string,
): HomeScoreStripItem[] {
  const latestCompleted = completedGroups
    .flatMap((group) => group.matches)
    .sort(
      (left, right) =>
        new Date(right.scheduledAt).getTime() - new Date(left.scheduledAt).getTime(),
    );
  const seen = new Set<string>();
  const items = [
    ...liveMatches.map((match) => liveScoreItem(match, timezone)),
    ...latestCompleted.map((match) => completedScoreItem(match, timezone)),
  ];

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 3);
}

function buildFixtures(
  matches: ResolvedHomepageMatch[],
  timezone: string,
): HomeUpcomingFixture[] {
  return matches.map((match) => ({
    id: match.id,
    href: matchHref(match.id, match.competitionId),
    dateLabel: formatDateLabel(match.scheduledAt, timezone),
    timeLabel: formatTimeLabel(match.scheduledAt, timezone),
    venueLabel: match.venue || null,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  }));
}

function buildLeagueStandings(rows: LeagueStanding[]): HomeStandingRow[] {
  return rows.map((row) => ({
    id: row.id,
    position: row.rank,
    team: row.team,
    played: row.played,
    won: row.wins,
    lost: row.losses,
    goalDifference: row.goalsFor - row.goalsAgainst,
    points: row.points,
  }));
}

function heroDetails(
  competition: CompetitionOption | null,
  edition: EditionContextValue | null,
  liveHref: string,
) {
  const editionLabel = competition?.label
    ?? (competition ? String(competition.season) : edition?.editionLabel ?? '');
  const competitionName = competition?.series?.name
    ?? competition?.name
    ?? edition?.competitionName;
  const eyebrow = competitionName
    ? `${competitionName} · ${editionLabel}`
    : 'Netball scores, fixtures and stories';

  return {
    eyebrow,
    primaryAction: {
      label: edition ? `Explore ${edition.editionLabel}` : 'Explore CentrePass',
      href: edition ? editionHref(edition) : '/live',
    },
    secondaryAction: {
      label: "See today's matches",
      href: liveHref,
    },
  };
}

export default async function HomePage() {
  let liveMatches: ResolvedHomepageMatch[] = [];
  let upcomingMatches: ResolvedHomepageMatch[] = [];
  let completedPage = {
    groups: [],
    nextCursor: null,
  } as Awaited<ReturnType<typeof getCompletedMatchesPage>>;
  let competition: CompetitionOption | null = null;
  let leagueStandings: LeagueStanding[] = [];
  let leagueStandingsUnavailable = false;
  let preview: GlasgowHomepagePreview | null = null;
  let databaseUnavailable = false;
  let usingUpstreamPreview = false;

  if (isUpstreamPreviewMode()) {
    const previewPage = await loadUpstreamCompletedMatches(glasgowUpstreamResultsParams());
    if (previewPage) {
      completedPage = previewPage;
      preview = buildGlasgowHomepagePreview();
      usingUpstreamPreview = true;
    } else {
      databaseUnavailable = true;
    }
  } else {
    try {
      const resolved = await timedQuery('competition_lookup', () => resolveCompetition());
      competition = resolved.competition;

      if (competition) {
        const activeCompetition = competition;
        const baseWhere = { ...excludeSimData, competitionId: activeCompetition.id };
        const standingsPromise = activeCompetition.series?.kind === 'LEAGUE'
          ? getStandingsForCompetition(activeCompetition.id)
            .then((rows) => ({ rows, unavailable: false }))
            .catch(() => ({ rows: [] as LeagueStanding[], unavailable: true }))
          : Promise.resolve({ rows: [] as LeagueStanding[], unavailable: false });

        const [live, upcoming, history, standings] = await Promise.all([
          timedQuery('home_live_matches', () => prisma.match.findMany({
            where: {
              ...baseWhere,
              status: 'LIVE',
              OR: [
                { stageId: null },
                { stage: { is: { isPublished: true } } },
              ],
            },
            select: homepageMatchSelect,
            orderBy: { scheduledAt: 'asc' },
            take: HOME_LIVE_MATCH_LIMIT,
          })),
          timedQuery('home_upcoming_matches', () => prisma.match.findMany({
            where: {
              ...baseWhere,
              status: 'SCHEDULED',
              scheduledAt: { gte: new Date() },
              homeTeamId: { not: null },
              awayTeamId: { not: null },
              OR: [
                { stageId: null },
                { stage: { is: { isPublished: true } } },
              ],
            },
            select: homepageMatchSelect,
            orderBy: { scheduledAt: 'asc' },
            take: HOME_UPCOMING_MATCH_LIMIT,
          })),
          timedQuery('home_completed_history', () => getCompletedMatchesPage(
            activeCompetition.id,
            undefined,
            [activeCompetition],
          )),
          standingsPromise,
        ]);

        liveMatches = live.filter(hasResolvedMatchTeams);
        upcomingMatches = upcoming.filter(hasResolvedMatchTeams);
        completedPage = history;
        leagueStandings = standings.rows;
        leagueStandingsUnavailable = standings.unavailable;
      }
    } catch {
      databaseUnavailable = true;
    }
  }

  const edition = competition?.series && competition.slug
    ? toEditionContext(competition)
    : preview?.edition ?? null;
  const timezone = preview?.edition.sourceTimezone ?? editionTimezone(competition);
  const hero = heroDetails(competition, edition, preview?.liveHref ?? '/live');
  const scores = buildScoreStripItems(liveMatches, completedPage.groups, timezone);
  const fixtures = preview
    ? preview.fixtures.map((fixture): HomeUpcomingFixture => ({
        id: fixture.id,
        href: preview.fixturesHref,
        dateLabel: formatDateLabel(fixture.scheduledAt, timezone),
        timeLabel: formatTimeLabel(fixture.scheduledAt, timezone),
        venueLabel: fixture.venue,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
      }))
    : buildFixtures(upcomingMatches, timezone);
  const isTournamentEdition = preview !== null
    || competition?.series?.kind === 'TOURNAMENT';
  const fixturesHref = preview?.fixturesHref
    ?? (edition ? editionHref(edition) : '/');
  const standingsHref = edition ? editionHref(edition, 'standings') : '/standings';
  const hasRecentResults = completedPage.groups.some((group) => group.matches.length > 0);
  const firstVisibleFixtureAt = preview
    ? preview.fixtures[0]?.scheduledAt
    : upcomingMatches[0]?.scheduledAt;
  const hasMatches = liveMatches.length > 0
    || fixtures.length > 0
    || hasRecentResults
    || completedPage.nextCursor !== null;

  return (
    <div>
      <JsonLd data={websiteJsonLd()} />
      <JsonLd data={breadcrumbJsonLd([
        { name: 'Home', url: '/' },
      ])} />

      <LandingHero
        editionEyebrow={hero.eyebrow}
        headline={'Every match.\nEvery team.\nEvery story.'}
        description="Live scores, player stats and the history behind the game."
        imageSrc="/landing/centrepass-matchday-hero.png"
        imageAlt="International netball players contesting the ball beneath the goal post"
        primaryAction={hero.primaryAction}
        secondaryAction={hero.secondaryAction}
      />

      <HomeScoreStrip items={scores} />

      <section className="bg-[#f8f8f9] px-5 py-7 sm:px-8 lg:px-16 lg:py-8">
        <div className="mx-auto max-w-[1360px]">
          {databaseUnavailable && (
            <div
              role="alert"
              className="mb-7 rounded-xl border border-error/30 bg-error/5 px-5 py-4 text-center"
            >
              <p className="font-headline text-lg font-bold text-primary">
                Scores temporarily unavailable
              </p>
              <p className="mt-1 font-label text-xs text-on-surface-variant">
                CentrePass could not reach the match database. Please try again in a few minutes.
              </p>
            </div>
          )}

          {!databaseUnavailable && !hasMatches && (
            <div className="mb-7 rounded-xl border border-outline-variant/50 bg-white px-5 py-4 text-center">
              <p className="font-headline text-lg font-bold text-primary">No fixtures yet</p>
              <p className="mt-1 font-label text-xs text-on-surface-variant">
                The latest edition is ready, but its match schedule has not been published.
              </p>
            </div>
          )}

          {usingUpstreamPreview && (
            <p className="sr-only">
              Local preview: showing current CentrePass results through the hosted read-only API.
            </p>
          )}

          {isTournamentEdition ? (
            <div className="space-y-10">
              <HomeUpcomingFixtures
                title="Upcoming fixtures"
                fixtures={fixtures}
                allFixturesLink={{ label: 'View all fixtures', href: fixturesHref }}
                emptyMessage="Knockout fixtures will appear here as soon as both teams are confirmed."
                timezoneNote={fixtures.length > 0
                  ? timezoneNote(firstVisibleFixtureAt, timezone)
                  : undefined}
              />
              {hasRecentResults && (
                <div className="border-t border-outline-variant/70 pt-8">
                  <HomeRecentResults groups={completedPage.groups} timezone={timezone} />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-10 lg:grid-cols-2 lg:gap-0">
                <div className="lg:pr-10">
                  <HomeUpcomingFixtures
                    title="Upcoming fixtures"
                    fixtures={fixtures}
                    allFixturesLink={{ label: 'View all fixtures', href: fixturesHref }}
                    timezoneNote={timezoneNote(firstVisibleFixtureAt, timezone)}
                  />
                </div>
                <div className="lg:border-l lg:border-outline-variant/70 lg:pl-10">
                  <HomeStandingsPreview
                    title="Standings"
                    rows={buildLeagueStandings(leagueStandings)}
                    fullStandingsLink={{
                      label: 'View full standings',
                      href: standingsHref,
                    }}
                    note={leagueStandingsUnavailable
                      ? 'Standings are temporarily unavailable. Please try again shortly.'
                      : leagueStandings.length > 0
                        ? 'Official competition standings.'
                        : 'Standings will appear once the competition table is published.'}
                  />
                </div>
              </div>

              {hasRecentResults && (
                <div className="mt-10 border-t border-outline-variant/70 pt-8">
                  <HomeRecentResults groups={completedPage.groups} timezone={timezone} />
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="bg-[#f8f8f9] px-5 pb-16 pt-8 sm:px-8 lg:px-16 lg:pb-20 lg:pt-10">
        <div className="mx-auto max-w-[1360px]">
          <MyTeams />
        </div>
      </section>
    </div>
  );
}
