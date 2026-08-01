import 'server-only';

import glasgowBundle from '../../../data/glasgow-2026/v1/bundle.json';
import type { EditionContextValue } from '@/lib/edition-context';
import { editionHref } from '@/lib/edition-links';
import type { HomeUpcomingFixtureCard } from '@/lib/home-feed';
import { upstreamPreviewOrigin } from '@/lib/upstream-preview';

export const GLASGOW_UPSTREAM_PREVIEW_EDITION: EditionContextValue = {
  id: 'glasgow-2026-upstream-preview',
  competitionSlug: 'commonwealth-games-netball',
  competitionName: 'Commonwealth Games Netball',
  editionSlug: 'glasgow-2026',
  editionLabel: 'Glasgow 2026',
  sourceTimezone: 'Europe/London',
  get navigationOrigin() {
    return upstreamPreviewOrigin() ?? undefined;
  },
};

export const SUNCORP_UPSTREAM_PREVIEW_EDITION: EditionContextValue = {
  id: 'suncorp-2026-upstream-preview',
  competitionSlug: 'suncorp-super-netball',
  competitionName: 'Suncorp Super Netball',
  editionSlug: '2026',
  editionLabel: '2026',
  sourceTimezone: 'Australia/Sydney',
  get navigationOrigin() {
    return upstreamPreviewOrigin() ?? undefined;
  },
};

/**
 * Hosted editions verified as public and ready for the development-only
 * upstream preview. Production navigation still comes from the database
 * publication/readiness directory.
 */
export const UPSTREAM_PREVIEW_EDITIONS: EditionContextValue[] = [
  GLASGOW_UPSTREAM_PREVIEW_EDITION,
  SUNCORP_UPSTREAM_PREVIEW_EDITION,
];

interface PreviewTeam {
  externalId?: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

interface PreviewFixture {
  id: string;
  href: string;
  scheduledAt: string;
  venue: string;
  homeTeam: PreviewTeam;
  awayTeam: PreviewTeam;
}

export interface GlasgowHomepagePreview {
  edition: EditionContextValue;
  fixtures: PreviewFixture[];
  fixturesHref: string;
  liveHref: string;
}

function explicitTeamId(side: object): string | null {
  if (!('teamExternalId' in side)) return null;
  return typeof side.teamExternalId === 'string' ? side.teamExternalId : null;
}

function resolveFutureFixtureTeams(
  sideA: object,
  sideB: object,
  teamById: Map<string, PreviewTeam>,
): [PreviewTeam, PreviewTeam] | null {
  const explicitA = explicitTeamId(sideA);
  const explicitB = explicitTeamId(sideB);
  if (!explicitA || !explicitB) return null;

  const homeTeam = teamById.get(explicitA);
  const awayTeam = teamById.get(explicitB);
  return homeTeam && awayTeam ? [homeTeam, awayTeam] : null;
}

export function buildGlasgowHomepagePreview(
  now = new Date(),
  hostedFixtures?: readonly HomeUpcomingFixtureCard[],
): GlasgowHomepagePreview {
  const previewOrigin = upstreamPreviewOrigin();
  const fixturesHref = editionHref(GLASGOW_UPSTREAM_PREVIEW_EDITION);
  const teamById = new Map(
    glasgowBundle.teams.map((team): [string, PreviewTeam] => [
      team.externalId,
      {
        externalId: team.externalId,
        name: team.name,
        abbreviation: team.abbreviation,
        logoUrl: null,
      },
    ]),
  );
  const fixtures = hostedFixtures === undefined
    ? glasgowBundle.matches
      .filter((match) => new Date(match.scheduledAt).getTime() >= now.getTime())
      .flatMap((match): PreviewFixture[] => {
        const teams = resolveFutureFixtureTeams(
          match.sideA,
          match.sideB,
          teamById,
        );
        if (!teams) return [];

        return [{
          id: match.externalId,
          href: fixturesHref,
          scheduledAt: match.scheduledAt,
          venue: match.venue,
          homeTeam: teams[0],
          awayTeam: teams[1],
        }];
      })
      .slice(0, 5)
    : hostedFixtures.map((fixture): PreviewFixture => ({
        id: fixture.id,
        href: fixture.href,
        scheduledAt: fixture.scheduledAt,
        venue: fixture.venue,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
      }));

  return {
    edition: GLASGOW_UPSTREAM_PREVIEW_EDITION,
    fixtures,
    fixturesHref,
    liveHref: previewOrigin ? `${previewOrigin}/live` : '/live',
  };
}
