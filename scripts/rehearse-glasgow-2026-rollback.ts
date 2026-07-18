import { createHash } from 'node:crypto';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { resolveGlasgow2026Foundation } from '@/lib/glasgow/edition';
import { loadGlasgowFoundationSourceEvidence } from '@/lib/glasgow/source-manifest';
import { JsonCompetitionAdapter } from '@/lib/sources/adapter';
import {
  CONTROLLED_IMPORT_ROLLBACK_REHEARSAL_ERROR,
  loadPrismaImportPlanningState,
  PrismaCompetitionImportWriter,
} from '@/lib/sources/prisma-writer';
import { CompetitionImportService } from '@/lib/sources/service';
import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Glasgow rollback rehearsal failed: ${message}`);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function canonicalState(
  competitionId: string,
  sourceSystemId: string,
  editionSourceId: string,
  canonicalChampionDataPlayerIds: number[],
) {
  const [
    teams,
    entries,
    players,
    rosters,
    matches,
    slots,
    quarters,
    coverage,
    mappings,
    snapshots,
    mutations,
    editionSource,
    canonicalPhotos,
  ] = await Promise.all([
    prisma.team.count({ where: { competitionId } }),
    prisma.editionEntry.count({ where: { competitionId } }),
    prisma.player.count(),
    prisma.rosterMembership.count({ where: { editionEntry: { competitionId } } }),
    prisma.match.count({ where: { competitionId } }),
    prisma.matchSlot.count({ where: { match: { competitionId } } }),
    prisma.matchQuarter.count({ where: { match: { competitionId } } }),
    prisma.dataCoverage.count({ where: { competitionId } }),
    prisma.sourceEntityMapping.count({ where: { sourceSystemId, competitionId } }),
    prisma.sourceSnapshot.count({ where: { sourceSystemId, competitionId } }),
    prisma.importMutation.count({ where: { importRun: { sourceSystemId, competitionId } } }),
    prisma.editionSource.findUnique({
      where: { id: editionSourceId },
      select: { lastSyncedAt: true },
    }),
    prisma.player.findMany({
      where: { championDataPlayerId: { in: canonicalChampionDataPlayerIds } },
      orderBy: { championDataPlayerId: 'asc' },
      select: {
        id: true,
        championDataPlayerId: true,
        photoUrl: true,
        photoSourceUrl: true,
        photoCredit: true,
        photoLicense: true,
        photoVerifiedAt: true,
      },
    }),
  ]);
  return {
    teams,
    entries,
    players,
    rosters,
    matches,
    slots,
    quarters,
    coverage,
    mappings,
    snapshots,
    mutations,
    editionSourceLastSyncedAt: editionSource?.lastSyncedAt?.toISOString() ?? null,
    canonicalPhotoFingerprint: fingerprint(canonicalPhotos),
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function main() {
  const target = verifyPreviewDatabaseTarget();
  const bundlePath = path.resolve('data/glasgow-2026/v1/bundle.json');
  const evidence = await loadGlasgowFoundationSourceEvidence(bundlePath);
  const foundation = await resolveGlasgow2026Foundation(prisma);
  const planningState = await loadPrismaImportPlanningState(prisma, {
    sourceSystemId: foundation.sourceSystemId,
    competitionId: foundation.editionId,
  });
  const options = {
    sourceSystemId: foundation.sourceSystemId,
    competitionId: foundation.editionId,
    editionSourceId: foundation.editionSourceId,
    expectedPublicationStatus: 'DRAFT' as const,
    requireMatchingDryRun: true,
    receiptMetadata: evidence.receiptMetadata,
    completeEditionRosterSnapshot: true,
    coverageSourcePrecedence: 'INCOMING_SOURCE' as const,
    controlledFailurePoint: 'BEFORE_AUDIT_FLUSH' as const,
  };
  const service = new CompetitionImportService(
    new JsonCompetitionAdapter(),
    {
      sourceSystemId: foundation.sourceSystemId,
      competitionId: foundation.editionId,
      ...planningState,
      allowUnresolvedMatches: true,
    },
    new PrismaCompetitionImportWriter(prisma, options),
  );
  const { preview } = await service.preview(evidence.bundleText);
  invariant(preview.valid, 'the exact bundle preview is invalid');
  invariant(preview.issues.length === 0, 'the exact bundle preview has issues');
  invariant(preview.unresolved.length === 0, 'the exact bundle preview has unresolved identities');

  const priorAppliedCount = await prisma.importRun.count({
    where: {
      sourceSystemId: foundation.sourceSystemId,
      competitionId: foundation.editionId,
      checksum: preview.checksum,
      status: 'SUCCEEDED',
      dryRun: false,
    },
  });
  invariant(priorAppliedCount === 0,
    'a prior applied receipt exists; the preview state is not fresh enough for this rehearsal');

  const canonicalChampionDataPlayerIds = evidence.publicationExpectation.canonicalPlayers
    .map((player) => player.championDataPlayerId);
  const [before, failedReceiptCountBefore] = await Promise.all([
    canonicalState(
      foundation.editionId,
      foundation.sourceSystemId,
      foundation.editionSourceId,
      canonicalChampionDataPlayerIds,
    ),
    prisma.importRun.count({
      where: {
        sourceSystemId: foundation.sourceSystemId,
        competitionId: foundation.editionId,
        checksum: preview.checksum,
        status: 'FAILED',
        errorMessage: CONTROLLED_IMPORT_ROLLBACK_REHEARSAL_ERROR,
      },
    }),
  ]);

  let controlledFailure: unknown;
  try {
    await service.execute(evidence.bundleText);
  } catch (error) {
    controlledFailure = error;
  }
  invariant(controlledFailure instanceof Error, 'controlled import unexpectedly succeeded');
  invariant(
    controlledFailure.message === CONTROLLED_IMPORT_ROLLBACK_REHEARSAL_ERROR,
    `unexpected failure: ${controlledFailure.message}`,
  );

  const [after, failedReceipts] = await Promise.all([
    canonicalState(
      foundation.editionId,
      foundation.sourceSystemId,
      foundation.editionSourceId,
      canonicalChampionDataPlayerIds,
    ),
    prisma.importRun.findMany({
      where: {
        sourceSystemId: foundation.sourceSystemId,
        competitionId: foundation.editionId,
        checksum: preview.checksum,
        status: 'FAILED',
        errorMessage: CONTROLLED_IMPORT_ROLLBACK_REHEARSAL_ERROR,
      },
      orderBy: { startedAt: 'asc' },
      select: { id: true, metadata: true },
    }),
  ]);
  invariant(JSON.stringify(after) === JSON.stringify(before),
    'canonical state changed despite the failed serializable transaction');
  invariant(failedReceipts.length === failedReceiptCountBefore + 1,
    'the controlled failure receipt was not persisted exactly once');
  const failureReceipt = failedReceipts.at(-1);
  invariant(failureReceipt, 'the controlled failure receipt is missing');
  invariant(
    isJsonObject(failureReceipt.metadata)
      && failureReceipt.metadata.controlledFailurePoint === 'BEFORE_AUDIT_FLUSH',
    'the controlled failure receipt is missing its rehearsal marker',
  );

  console.log(JSON.stringify({
    status: 'verified-import-transaction-rollback',
    expectedPreviewProjectRef: target.expectedPreviewProjectRef,
    productionProjectRef: target.productionProjectRef,
    checksum: preview.checksum,
    failedImportRunId: failureReceipt.id,
    canonicalState: after,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
