import type { MetadataRoute } from 'next';
import { prisma, excludeSimData } from '@/lib/db';
import { getPublicCompetitions } from '@/lib/competitions';
import { matchHref } from '@/lib/edition-links';

// Render applies Prisma migrations after the build step. Defer this database
// read until runtime so an additive schema deploy can build against the previous
// release's database shape and then start only after pre-deploy migrations.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const baseUrl = 'https://centrepass.io';
  const publicEditionIds = (await getPublicCompetitions()).map((edition) => edition.id);

  // Fetch all indexable entities
  const [teams, matches, players] = await Promise.all([
    prisma.team.findMany({
      where: {
        OR: [
          { competitionId: { in: publicEditionIds } },
          { editionEntries: { some: { competitionId: { in: publicEditionIds } } } },
        ],
      },
      select: { slug: true },
    }),
    prisma.match.findMany({
      where: { ...excludeSimData, competitionId: { in: publicEditionIds } },
      select: { id: true, competitionId: true, scheduledAt: true },
    }),
    prisma.player.findMany({
      where: {
        OR: [
          { team: { competitionId: { in: publicEditionIds } } },
          { rosterMemberships: { some: { editionEntry: { competitionId: { in: publicEditionIds } } } } },
        ],
      },
      select: { id: true },
    }),
  ]);

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/standings`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/teams`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // Team pages
  const teamPages: MetadataRoute.Sitemap = teams.map((team) => ({
    url: `${baseUrl}/team/${team.slug}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // Match pages (box score only — /live and /court are noindexed)
  const matchPages: MetadataRoute.Sitemap = matches.map((match) => ({
    url: `${baseUrl}${matchHref(match.id, match.competitionId)}`,
    lastModified: match.scheduledAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  // Player pages
  const playerPages: MetadataRoute.Sitemap = players.map((player) => ({
    url: `${baseUrl}/player/${player.id}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...teamPages, ...matchPages, ...playerPages];
}
