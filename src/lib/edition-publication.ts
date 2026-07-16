import type { PrismaClient } from '@prisma/client';
import {
  evaluateEditionPublicationReadiness,
  isGlasgow2026Identity,
} from '@/lib/edition-publication-readiness';
export {
  evaluateEditionPublicationReadiness,
  type EditionPublicationReadiness,
  type EditionPublicationReadinessInput,
  type EditionStagePublicationReadinessInput,
} from '@/lib/edition-publication-readiness';

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
      stages: {
        orderBy: { sequence: 'asc' },
        select: {
          slug: true,
          type: true,
          sequence: true,
          isPublished: true,
          _count: { select: { groups: true, matches: true } },
        },
      },
    },
  });

  if (!edition) {
    throw new Error(`Edition not found: ${identity.competitionSlug}/${identity.editionSlug}`);
  }

  const isGlasgow2026 = isGlasgow2026Identity(identity);
  const [matchSlotCount, cleanSuccessfulImportCount] = isGlasgow2026
    ? await Promise.all([
      prisma.matchSlot.count({ where: { match: { competitionId: edition.id } } }),
      prisma.importRun.count({
        where: {
          competitionId: edition.id,
          sourceSystem: { key: 'glasgow-2026-public-data' },
          status: 'SUCCEEDED',
          dryRun: false,
          issueCount: 0,
        },
      }),
    ])
    : [undefined, undefined];

  const readiness = evaluateEditionPublicationReadiness({
    competitionSlug: identity.competitionSlug,
    editionSlug: identity.editionSlug,
    publicationStatus: edition.publicationStatus,
    teamCount: edition._count.entries,
    matchCount: edition._count.matches,
    matchSlotCount,
    cleanSuccessfulImportCount,
    // publishEdition makes the valid stage set public atomically below. This
    // lets the command also repair a previously published edition whose stage
    // flags were reset by an old importer replay.
    requirePublishedStages: false,
    stages: edition.stages.map((stage) => ({
      slug: stage.slug,
      type: stage.type,
      sequence: stage.sequence,
      isPublished: stage.isPublished,
      groupCount: stage._count.groups,
      matchCount: stage._count.matches,
    })),
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
