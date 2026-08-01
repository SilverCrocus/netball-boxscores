import { NextResponse } from 'next/server';
import {
  resolveCompetition,
  resolveCompetitionById,
  resolveEdition,
  resolveLegacyLeagueCompetition,
} from '@/lib/competitions';
import {
  buildHomeUpcomingFixtures,
  getCompletedMatchesPage,
} from '@/lib/home-feed';
import { getEditionSchedule } from '@/lib/edition-schedule';
import {
  isUpstreamPreviewMode,
  loadUpstreamCompletedMatches,
} from '@/lib/upstream-preview';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const season = searchParams.get('season') ?? undefined;
  const edition = searchParams.get('edition') ?? undefined;
  const cursor = searchParams.get('cursor') ?? undefined;
  const competitionSlug = searchParams.get('competitionSlug')?.trim() || undefined;
  const editionSlug = searchParams.get('editionSlug')?.trim() || undefined;
  const shouldIncludeUpcoming = searchParams.get('includeUpcoming') === 'true'
    && Boolean(competitionSlug && editionSlug)
    && cursor === undefined;

  if (Boolean(competitionSlug) !== Boolean(editionSlug)) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_EDITION_IDENTITY',
          message: 'competitionSlug and editionSlug must be provided together.',
          retryable: false,
        },
      },
      { status: 400 },
    );
  }

  if (isUpstreamPreviewMode()) {
    const previewPage = await loadUpstreamCompletedMatches(searchParams);
    if (previewPage) {
      return NextResponse.json(shouldIncludeUpcoming
        ? previewPage
        : { groups: previewPage.groups, nextCursor: previewPage.nextCursor });
    }
  }

  try {
    const competition = competitionSlug && editionSlug
      ? (await resolveEdition({ competitionSlug, editionSlug })).edition
      : edition
        ? (await resolveCompetitionById(edition)).competition
        : season
          ? (await resolveLegacyLeagueCompetition(season)).competition
          : (await resolveCompetition()).competition;

    if (!competition) {
      return NextResponse.json(
        { error: { code: 'NO_COMPETITION', message: 'No competition is available.', retryable: false } },
        { status: 404 },
      );
    }

    const completedPage = await getCompletedMatchesPage(
      competition.id,
      cursor,
      [competition],
    );

    if (!shouldIncludeUpcoming) {
      return NextResponse.json(completedPage);
    }

    try {
      const schedule = await getEditionSchedule(competition);
      return NextResponse.json({
        ...completedPage,
        upcomingFixtures: buildHomeUpcomingFixtures(schedule),
      });
    } catch {
      // Upcoming fixtures are an optional enhancement. A schedule-specific
      // failure must not hide otherwise healthy completed results.
      return NextResponse.json(completedPage);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CURSOR') {
      return NextResponse.json(
        { error: { code: 'INVALID_CURSOR', message: 'The results cursor is invalid.', retryable: false } },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: { code: 'RESULTS_UNAVAILABLE', message: 'Earlier results are temporarily unavailable.', retryable: true } },
      { status: 503 },
    );
  }
}
