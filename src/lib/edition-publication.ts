import type { PrismaClient, PublicationStatus } from '@prisma/client';
import {
  MIN_PUBLIC_EDITION_MATCHES,
  MIN_PUBLIC_EDITION_TEAMS,
} from '@/lib/competitions';

export interface EditionPublicationReadinessInput {
  publicationStatus: PublicationStatus;
  teamCount: number;
  matchCount: number;
}

export interface EditionPublicationReadiness {
  ready: boolean;
  blockers: string[];
}

export function evaluateEditionPublicationReadiness(
  input: EditionPublicationReadinessInput,
): EditionPublicationReadiness {
  const blockers: string[] = [];

  if (input.publicationStatus === 'ARCHIVED') {
    blockers.push('archived editions must be restored to draft before publication');
  }
  if (input.teamCount < MIN_PUBLIC_EDITION_TEAMS) {
    blockers.push(`requires at least ${MIN_PUBLIC_EDITION_TEAMS} participating teams; found ${input.teamCount}`);
  }
  if (input.matchCount < MIN_PUBLIC_EDITION_MATCHES) {
    blockers.push(`requires at least ${MIN_PUBLIC_EDITION_MATCHES} match; found ${input.matchCount}`);
  }

  return { ready: blockers.length === 0, blockers };
}

export async function publishEdition(
  prisma: PrismaClient,
  identity: { competitionSlug: string; editionSlug: string },
) {
  const edition = await prisma.competition.findFirst({
    where: {
      series: { slug: identity.competitionSlug },
      slug: identity.editionSlug,
    },
    select: {
      id: true,
      name: true,
      publicationStatus: true,
      _count: {
        select: {
          entries: { where: { status: 'ACTIVE' } },
          matches: true,
        },
      },
    },
  });

  if (!edition) {
    throw new Error(`Edition not found: ${identity.competitionSlug}/${identity.editionSlug}`);
  }

  const readiness = evaluateEditionPublicationReadiness({
    publicationStatus: edition.publicationStatus,
    teamCount: edition._count.entries,
    matchCount: edition._count.matches,
  });

  if (!readiness.ready) {
    throw new Error(`Edition is not publication-ready: ${readiness.blockers.join('; ')}`);
  }

  const publishedAt = new Date();
  await prisma.$transaction([
    prisma.competition.update({
      where: { id: edition.id },
      data: { publicationStatus: 'PUBLISHED', publishedAt },
    }),
    prisma.stage.updateMany({
      where: { competitionId: edition.id },
      data: { isPublished: true },
    }),
  ]);

  return {
    editionId: edition.id,
    name: edition.name,
    teamCount: edition._count.entries,
    matchCount: edition._count.matches,
    publishedAt,
  };
}
