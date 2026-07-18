import { NextResponse } from 'next/server';
import {
  resolveCompetition,
  resolveCompetitionById,
  resolveLegacyLeagueCompetition,
} from '@/lib/competitions';
import { getCompletedMatchesPage } from '@/lib/home-feed';
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

  if (isUpstreamPreviewMode()) {
    const previewPage = await loadUpstreamCompletedMatches(searchParams);
    if (previewPage) return NextResponse.json(previewPage);
  }

  try {
    const { competition } = edition
      ? await resolveCompetitionById(edition)
      : season
        ? await resolveLegacyLeagueCompetition(season)
        : await resolveCompetition();

    if (!competition) {
      return NextResponse.json(
        { error: { code: 'NO_COMPETITION', message: 'No competition is available.', retryable: false } },
        { status: 404 },
      );
    }

    return NextResponse.json(await getCompletedMatchesPage(
      competition.id,
      cursor,
      [competition],
    ));
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
