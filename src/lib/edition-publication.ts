import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  evaluateEditionPublicationReadiness,
  isGlasgow2026Identity,
} from '@/lib/edition-publication-readiness';
import type { GlasgowPublicationExpectation } from '@/lib/glasgow/source-manifest';
export {
  evaluateEditionPublicationReadiness,
  type EditionPublicationReadiness,
  type EditionPublicationReadinessInput,
  type EditionStagePublicationReadinessInput,
} from '@/lib/edition-publication-readiness';

export interface PublishEditionOptions {
  dryRun?: boolean;
  confirmationToken?: string;
  glasgowExpectation?: GlasgowPublicationExpectation;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function receiptKind(metadata: Prisma.JsonValue | null): string | null {
  if (!isObject(metadata)) return null;
  return typeof metadata.importKind === 'string' ? metadata.importKind : null;
}

function stringArrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sourceManifestMatches(
  metadata: Prisma.JsonValue | null,
  expectation: GlasgowPublicationExpectation,
): boolean {
  if (!isObject(metadata) || !isObject(metadata.sourceManifest)) return false;
  const manifest = metadata.sourceManifest;
  const sourceIds = Array.isArray(manifest.sourceIds)
    ? manifest.sourceIds.filter((value): value is string => typeof value === 'string').toSorted()
    : [];
  return manifest.bundleFileSha256 === expectation.bundleFileSha256
    && manifest.manifestFileSha256 === expectation.manifestFileSha256
    && manifest.sourceCount === expectation.sourceIds.length
    && manifest.publicationStatusPolicy === 'DRAFT_ONLY'
    && stringArrayEqual(sourceIds, expectation.sourceIds.toSorted());
}

function publicationToken(input: {
  editionId: string;
  expectedChecksum: string;
  appliedImportRunId: string;
  dryRunImportRunId: string;
  manifestChecksum: string;
}): string {
  return createHash('sha256')
    .update([
      input.editionId,
      input.expectedChecksum,
      input.appliedImportRunId,
      input.dryRunImportRunId,
      input.manifestChecksum,
    ].join(':'))
    .digest('hex');
}

export async function publishEdition(
  prisma: PrismaClient,
  identity: { competitionSlug: string; editionSlug: string },
  options: PublishEditionOptions = {},
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
  let matchSlotCount: number | undefined;
  let activeRosterCount: number | undefined;
  let cleanSuccessfulImportCount: number | undefined;
  let latestAppliedImportChecksum: string | null | undefined;
  let latestCleanDryRunChecksum: string | null | undefined;
  let sourceMappingsComplete: boolean | undefined;
  let provenanceComplete: boolean | undefined;
  let coverageComplete: boolean | undefined;
  let unresolvedValidationIssueCount: number | undefined;
  let confirmationToken: string | null = null;

  if (isGlasgow2026) {
    const expectation = options.glasgowExpectation;
    if (!expectation) {
      throw new Error('Glasgow publication requires the verified source-manifest expectation');
    }
    const source = await prisma.sourceSystem.findUnique({
      where: { key: 'glasgow-2026-public-data' },
      select: { id: true },
    });
    if (!source) throw new Error('Glasgow source system was not found');

    const [
      slotCount,
      rosterCount,
      recentRuns,
      mappings,
      coverage,
      openIssueCount,
    ] = await Promise.all([
      prisma.matchSlot.count({ where: { match: { competitionId: edition.id } } }),
      prisma.rosterMembership.count({
        where: {
          editionEntry: { competitionId: edition.id },
          status: 'ACTIVE',
          validTo: null,
        },
      }),
      prisma.importRun.findMany({
        where: {
          competitionId: edition.id,
          sourceSystemId: source.id,
          status: 'SUCCEEDED',
          issueCount: 0,
        },
        orderBy: { completedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          dryRun: true,
          checksum: true,
          completedAt: true,
          metadata: true,
        },
      }),
      prisma.sourceEntityMapping.findMany({
        where: {
          competitionId: edition.id,
          sourceSystemId: source.id,
          entityType: { in: ['TEAM', 'PLAYER', 'MATCH'] },
        },
        select: { entityType: true, externalId: true, internalEntityId: true },
      }),
      prisma.dataCoverage.findMany({
        where: {
          competitionId: edition.id,
          sourceSystemId: source.id,
          matchId: null,
        },
        select: { capability: true, state: true },
      }),
      prisma.importIssue.count({
        where: {
          importRun: { competitionId: edition.id, sourceSystemId: source.id },
          severity: 'ERROR',
          status: 'OPEN',
        },
      }),
    ]);
    matchSlotCount = slotCount;
    activeRosterCount = rosterCount;
    unresolvedValidationIssueCount = openIssueCount;

    const foundationRuns = recentRuns.filter((run) => receiptKind(run.metadata) === 'GLASGOW_FOUNDATION');
    const latestApplied = foundationRuns.find((run) => !run.dryRun) ?? null;
    const latestCleanDryRun = foundationRuns.find((run) => run.dryRun) ?? null;
    latestAppliedImportChecksum = latestApplied?.checksum ?? null;
    latestCleanDryRunChecksum = latestCleanDryRun?.checksum ?? null;
    cleanSuccessfulImportCount = foundationRuns.filter((run) => !run.dryRun).length;
    provenanceComplete = Boolean(
      latestApplied
      && latestCleanDryRun
      && sourceManifestMatches(latestApplied.metadata, expectation)
      && sourceManifestMatches(latestCleanDryRun.metadata, expectation),
    );

    const expectedMappings = {
      TEAM: expectation.teamExternalIds,
      PLAYER: expectation.playerExternalIds,
      MATCH: expectation.matchExternalIds,
    } as const;
    const mappingSetsComplete = Object.entries(expectedMappings).every(([entityType, expected]) => {
      const actualMappings = mappings.filter((mapping) => mapping.entityType === entityType);
      const actual = actualMappings
        .map((mapping) => mapping.externalId)
        .toSorted();
      const uniqueInternalIds = new Set(
        actualMappings.map((mapping) => mapping.internalEntityId),
      );
      return stringArrayEqual(actual, expected.toSorted())
        && uniqueInternalIds.size === actualMappings.length;
    });
    const playerMappings = new Map(
      mappings
        .filter((mapping) => mapping.entityType === 'PLAYER')
        .map((mapping) => [mapping.externalId, mapping.internalEntityId]),
    );
    const canonicalInternalIds = expectation.canonicalPlayers.flatMap((player) => {
      const id = playerMappings.get(player.externalId);
      return id ? [id] : [];
    });
    const canonicalPlayers = canonicalInternalIds.length > 0
      ? await prisma.player.findMany({
        where: { id: { in: canonicalInternalIds } },
        select: { id: true, championDataPlayerId: true },
      })
      : [];
    const canonicalById = new Map(
      canonicalPlayers.map((player) => [player.id, player.championDataPlayerId]),
    );
    const canonicalComplete = expectation.canonicalPlayers.every((player) => {
      const internalId = playerMappings.get(player.externalId);
      return internalId !== undefined
        && canonicalById.get(internalId) === player.championDataPlayerId;
    });
    sourceMappingsComplete = mappingSetsComplete && canonicalComplete;

    const actualCoverage = coverage
      .map((item) => `${item.capability}:${item.state}`)
      .toSorted();
    const expectedCoverage = expectation.editionCoverage
      .map((item) => `${item.capability}:${item.state}`)
      .toSorted();
    coverageComplete = stringArrayEqual(actualCoverage, expectedCoverage);

    if (latestApplied && latestCleanDryRun) {
      confirmationToken = publicationToken({
        editionId: edition.id,
        expectedChecksum: expectation.importChecksum,
        appliedImportRunId: latestApplied.id,
        dryRunImportRunId: latestCleanDryRun.id,
        manifestChecksum: expectation.manifestFileSha256,
      });
    }
  }

  const readiness = evaluateEditionPublicationReadiness({
    competitionSlug: identity.competitionSlug,
    editionSlug: identity.editionSlug,
    publicationStatus: edition.publicationStatus,
    teamCount: edition._count.entries,
    matchCount: edition._count.matches,
    matchSlotCount,
    activeRosterCount,
    cleanSuccessfulImportCount,
    expectedImportChecksum: options.glasgowExpectation?.importChecksum,
    latestAppliedImportChecksum,
    latestCleanDryRunChecksum,
    sourceMappingsComplete,
    provenanceComplete,
    coverageComplete,
    unresolvedValidationIssueCount,
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
  if (isGlasgow2026 && !confirmationToken) {
    throw new Error('Glasgow publication could not derive a confirmation token from clean receipts');
  }

  const dryRun = options.dryRun ?? true;
  if (dryRun) {
    return {
      status: 'ready' as const,
      dryRun: true,
      editionId: edition.id,
      name: edition.name,
      teamCount: edition._count.entries,
      matchCount: edition._count.matches,
      activeRosterCount,
      confirmationToken,
    };
  }
  if (isGlasgow2026 && options.confirmationToken !== confirmationToken) {
    throw new Error('Glasgow publication confirmation token does not match the current dry-run state');
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
    status: 'published' as const,
    dryRun: false,
    editionId: edition.id,
    name: edition.name,
    teamCount: edition._count.entries,
    matchCount: edition._count.matches,
    activeRosterCount,
    publishedAt,
  };
}

/** Emergency publication rollback. Imported data and audit receipts are kept. */
export async function unpublishEdition(
  prisma: PrismaClient,
  identity: { competitionSlug: string; editionSlug: string },
) {
  const edition = await prisma.competition.findFirst({
    where: { series: { slug: identity.competitionSlug }, slug: identity.editionSlug },
    select: { id: true, name: true, publicationStatus: true },
  });
  if (!edition) throw new Error(`Edition not found: ${identity.competitionSlug}/${identity.editionSlug}`);
  if (edition.publicationStatus === 'ARCHIVED') {
    throw new Error('Archived editions cannot be emergency-unpublished');
  }
  if (edition.publicationStatus === 'DRAFT') {
    return { editionId: edition.id, name: edition.name, status: 'DRAFT' as const, changed: false };
  }

  await prisma.$transaction([
    prisma.competition.update({
      where: { id: edition.id },
      data: { publicationStatus: 'DRAFT', publishedAt: null },
    }),
    prisma.stage.updateMany({
      where: { competitionId: edition.id },
      data: { isPublished: false },
    }),
  ]);
  return { editionId: edition.id, name: edition.name, status: 'DRAFT' as const, changed: true };
}
