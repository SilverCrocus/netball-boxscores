import React from 'react';

// Constants
export const SITE_NAME = 'CentrePass';
export const SITE_URL = 'https://centrepass.io';
export const DEFAULT_DESCRIPTION =
  'Live scores, box scores, standings, fixtures, and player stats for Suncorp Super Netball.';

// JSON-LD component — renders a <script type="application/ld+json"> tag
// Uses dangerouslySetInnerHTML to ensure JSON is emitted as raw text
// (special characters in team/venue names won't break the markup)
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return React.createElement('script', {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: {
      __html: JSON.stringify({ '@context': 'https://schema.org', ...data }),
    },
  });
}

// --- JSON-LD Builder Functions ---

export function websiteJsonLd() {
  return {
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
  };
}

export function breadcrumbJsonLd(
  items: { name: string; url: string }[],
) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

export function sportsEventJsonLd(match: {
  homeTeamName: string;
  awayTeamName: string;
  venue: string;
  scheduledAt: Date | string;
  homeScore: number;
  awayScore: number;
  matchLabel: string;
}) {
  return {
    '@type': 'SportsEvent',
    name: `${match.homeTeamName} vs ${match.awayTeamName} - ${match.matchLabel}`,
    startDate: new Date(match.scheduledAt).toISOString(),
    location: {
      '@type': 'Place',
      name: match.venue,
    },
    homeTeam: {
      '@type': 'SportsTeam',
      name: match.homeTeamName,
    },
    awayTeam: {
      '@type': 'SportsTeam',
      name: match.awayTeamName,
    },
    // Schema.org has no "live" or "completed" event status — all map to EventScheduled
    eventStatus: 'https://schema.org/EventScheduled',
  };
}

export function sportsTeamJsonLd(team: {
  name: string;
  slug: string;
  logoUrl: string | null;
}) {
  return {
    '@type': 'SportsTeam',
    name: team.name,
    sport: 'Netball',
    url: `${SITE_URL}/team/${team.slug}`,
    ...(team.logoUrl ? { logo: team.logoUrl } : {}),
    memberOf: {
      '@type': 'SportsOrganization',
      name: 'Suncorp Super Netball',
    },
  };
}

export function personJsonLd(player: {
  name: string;
  position: string;
  dateOfBirth: Date | string | null;
  nationality: string | null;
  teamName: string;
  teamSlug: string;
}) {
  return {
    '@type': 'Person',
    name: player.name,
    jobTitle: player.position,
    ...(player.dateOfBirth
      ? { birthDate: new Date(player.dateOfBirth).toISOString().split('T')[0] }
      : {}),
    ...(player.nationality ? { nationality: player.nationality } : {}),
    memberOf: {
      '@type': 'SportsTeam',
      name: player.teamName,
      url: `${SITE_URL}/team/${player.teamSlug}`,
    },
  };
}
