import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const baseUrl = 'https://centrepass.io';

  // Fetch all indexable entities
  const [teams, matches, players] = await Promise.all([
    prisma.team.findMany({ select: { slug: true } }),
    prisma.match.findMany({
      where: process.env.SIMULATION_MODE === 'true' ? {} : { round: { not: 99 } },
      select: { id: true, scheduledAt: true },
    }),
    prisma.player.findMany({ select: { id: true } }),
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
    url: `${baseUrl}/match/${match.id}`,
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
