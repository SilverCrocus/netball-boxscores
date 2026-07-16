import type { PrismaClient } from '@prisma/client';

export const GLASGOW_2026_FOUNDATION = {
  series: {
    slug: 'commonwealth-games-netball',
    name: 'Commonwealth Games Netball',
    kind: 'TOURNAMENT' as const,
    governingBody: 'Commonwealth Sport',
  },
  ruleset: {
    slug: 'international-netball-2026',
    name: 'International Netball 2026',
    periodCount: 4,
    regulationPeriodMinutes: 15,
    scoringModel: 'STANDARD',
    standingsStrategyKey: 'INTERNATIONAL_POOL',
    superShotsEnabled: false,
  },
  edition: {
    slug: 'glasgow-2026',
    name: 'Glasgow 2026 Netball',
    label: 'Glasgow 2026',
    season: 2026,
    sourceTimezone: 'Europe/London',
    seasonStart: new Date('2026-07-25T00:00:00.000Z'),
    seasonEnd: new Date('2026-08-02T23:59:59.999Z'),
  },
  stages: [
    { slug: 'pool-stage', name: 'Pool Stage', type: 'POOL' as const, sequence: 1 },
    { slug: 'classification', name: 'Classification Matches', type: 'CLASSIFICATION' as const, sequence: 2 },
    { slug: 'semi-finals', name: 'Semi-finals', type: 'SEMI_FINALS' as const, sequence: 3 },
    { slug: 'medal-matches', name: 'Medal Matches', type: 'MEDAL_MATCHES' as const, sequence: 4 },
  ],
  groups: [
    { slug: 'pool-a', name: 'Pool A', sequence: 1 },
    { slug: 'pool-b', name: 'Pool B', sequence: 2 },
  ],
  source: {
    key: 'glasgow-2026-public-data',
    name: 'Glasgow 2026 public data',
    externalId: 'glasgow-2026',
  },
} as const;

export interface Glasgow2026FoundationReference {
  editionId: string;
  sourceSystemId: string;
  editionSourceId: string;
}

/**
 * Resolve the already-provisioned import foundation without writing. Database
 * previews use this path so a missing foundation is reported rather than
 * silently created by what should be a read-only command.
 */
export async function resolveGlasgow2026Foundation(
  prisma: PrismaClient,
): Promise<Glasgow2026FoundationReference> {
  const editionSource = await prisma.editionSource.findFirst({
    where: {
      externalId: GLASGOW_2026_FOUNDATION.source.externalId,
      sourceSystem: { key: GLASGOW_2026_FOUNDATION.source.key },
      competition: {
        slug: GLASGOW_2026_FOUNDATION.edition.slug,
        series: { slug: GLASGOW_2026_FOUNDATION.series.slug },
      },
    },
    select: {
      id: true,
      competitionId: true,
      sourceSystemId: true,
    },
  });

  if (!editionSource) {
    throw new Error(
      'Glasgow 2026 import foundation is missing; use --apply to create it, or use --offline-preview for a database-free preview',
    );
  }

  return {
    editionId: editionSource.competitionId,
    sourceSystemId: editionSource.sourceSystemId,
    editionSourceId: editionSource.id,
  };
}

export async function upsertGlasgow2026Foundation(prisma: PrismaClient) {
  return prisma.$transaction(async (transaction) => {
    const series = await transaction.competitionSeries.upsert({
      where: { slug: GLASGOW_2026_FOUNDATION.series.slug },
      update: {
        name: GLASGOW_2026_FOUNDATION.series.name,
        kind: GLASGOW_2026_FOUNDATION.series.kind,
        governingBody: GLASGOW_2026_FOUNDATION.series.governingBody,
      },
      create: GLASGOW_2026_FOUNDATION.series,
    });

    const ruleset = await transaction.ruleset.upsert({
      where: { slug: GLASGOW_2026_FOUNDATION.ruleset.slug },
      update: GLASGOW_2026_FOUNDATION.ruleset,
      create: GLASGOW_2026_FOUNDATION.ruleset,
    });

    const edition = await transaction.competition.upsert({
      where: {
        seriesId_slug: {
          seriesId: series.id,
          slug: GLASGOW_2026_FOUNDATION.edition.slug,
        },
      },
      update: {
        ...GLASGOW_2026_FOUNDATION.edition,
        name: GLASGOW_2026_FOUNDATION.edition.name,
        rulesetId: ruleset.id,
      },
      create: {
        ...GLASGOW_2026_FOUNDATION.edition,
        seriesId: series.id,
        rulesetId: ruleset.id,
        publicationStatus: 'DRAFT',
      },
    });

    const stages = new Map<string, string>();
    for (const stageInput of GLASGOW_2026_FOUNDATION.stages) {
      const stage = await transaction.stage.upsert({
        where: { competitionId_slug: { competitionId: edition.id, slug: stageInput.slug } },
        // A foundation replay must never unpublish an edition that has already
        // passed the explicit publication gate. Publication is editorial state,
        // not source-owned tournament metadata.
        update: stageInput,
        create: { ...stageInput, competitionId: edition.id, isPublished: false },
      });
      stages.set(stage.slug, stage.id);
    }

    const poolStageId = stages.get('pool-stage');
    if (!poolStageId) throw new Error('Pool stage was not created');
    for (const groupInput of GLASGOW_2026_FOUNDATION.groups) {
      await transaction.stageGroup.upsert({
        where: { stageId_slug: { stageId: poolStageId, slug: groupInput.slug } },
        update: groupInput,
        create: { ...groupInput, stageId: poolStageId },
      });
    }

    const sourceSystem = await transaction.sourceSystem.upsert({
      where: { key: GLASGOW_2026_FOUNDATION.source.key },
      update: {
        name: GLASGOW_2026_FOUNDATION.source.name,
        kind: 'PUBLIC_PAGE',
        rawPayloadStorageAllowed: true,
        config: {
          factualDataReuse: 'PUBLIC_FACTUAL_DATA_USER_ASSERTED',
          organiserApproval: 'NOT_CLAIMED',
          playerPhotos: 'SOURCED_AND_ATTRIBUTED_ONLY',
        },
      },
      create: {
        key: GLASGOW_2026_FOUNDATION.source.key,
        name: GLASGOW_2026_FOUNDATION.source.name,
        kind: 'PUBLIC_PAGE',
        rawPayloadStorageAllowed: true,
        config: {
          factualDataReuse: 'PUBLIC_FACTUAL_DATA_USER_ASSERTED',
          organiserApproval: 'NOT_CLAIMED',
          playerPhotos: 'SOURCED_AND_ATTRIBUTED_ONLY',
        },
      },
    });

    const editionSource = await transaction.editionSource.upsert({
      where: {
        competitionId_sourceSystemId_externalId: {
          competitionId: edition.id,
          sourceSystemId: sourceSystem.id,
          externalId: GLASGOW_2026_FOUNDATION.source.externalId,
        },
      },
      update: { enabled: true, priority: 100 },
      create: {
        competitionId: edition.id,
        sourceSystemId: sourceSystem.id,
        externalId: GLASGOW_2026_FOUNDATION.source.externalId,
        enabled: true,
        priority: 100,
      },
    });

    return {
      seriesId: series.id,
      rulesetId: ruleset.id,
      editionId: edition.id,
      sourceSystemId: sourceSystem.id,
      editionSourceId: editionSource.id,
      stageIds: Object.fromEntries(stages),
    };
  });
}
