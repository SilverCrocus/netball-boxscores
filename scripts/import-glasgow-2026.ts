import path from 'node:path';
import { prisma } from '@/lib/db';
import {
  resolveGlasgow2026Foundation,
} from '@/lib/glasgow/edition';
import { loadGlasgowFoundationSourceEvidence } from '@/lib/glasgow/source-manifest';
import { JsonCompetitionAdapter } from '@/lib/sources/adapter';
import {
  loadPrismaImportPlanningState,
  PrismaCompetitionImportWriter,
  recordPrismaImportPreview,
} from '@/lib/sources/prisma-writer';
import { CompetitionImportService } from '@/lib/sources/service';

function usage(): never {
  throw new Error(
    'Usage: npm run db:import:glasgow -- <bundle.json> [--offline-preview|--record-preview|--apply]',
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  const offlinePreview = process.argv.includes('--offline-preview');
  const recordPreview = process.argv.includes('--record-preview');
  const sourceFile = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  if (!sourceFile) usage();
  if (apply && offlinePreview) throw new Error('--offline-preview cannot be combined with --apply');
  if (apply && recordPreview) throw new Error('--record-preview cannot be combined with --apply');
  if (offlinePreview && recordPreview) {
    throw new Error('--offline-preview cannot be combined with --record-preview');
  }

  const bundlePath = path.resolve(sourceFile);
  const evidence = await loadGlasgowFoundationSourceEvidence(bundlePath);
  const sourceInput = evidence.bundleText;
  if (offlinePreview) {
    const service = new CompetitionImportService(
      new JsonCompetitionAdapter(),
      {
        sourceSystemId: 'glasgow-2026-public-data',
        competitionId: 'glasgow-2026',
        existingIdentities: [],
        knownStageSlugs: ['pool-stage', 'classification', 'semi-finals', 'medal-matches'],
        knownGroupSlugs: ['pool-a', 'pool-b'],
        standingsStrategyKey: 'INTERNATIONAL_POOL',
        allowUnresolvedMatches: true,
      }
    );
    const { preview } = await service.preview(sourceInput);
    console.log(JSON.stringify({
      mode: 'preview',
      transport: 'offline-preview',
      bundlePath,
      editionId: null,
      valid: preview.valid,
      checksum: preview.checksum,
      issues: preview.issues,
      unresolved: preview.unresolved,
      writes: preview.writes,
      nextStep: preview.valid
        ? 'Prepare the DRAFT foundation, then run a database-aware preview and --record-preview before --apply'
        : 'Resolve every blocking issue before applying',
    }, null, 2));
    if (!preview.valid) process.exitCode = 2;
    return;
  }
  const foundation = await resolveGlasgow2026Foundation(prisma);
  const planningState = await loadPrismaImportPlanningState(prisma, {
    sourceSystemId: foundation.sourceSystemId,
    competitionId: foundation.editionId,
  });
  const writer = new PrismaCompetitionImportWriter(prisma, {
    sourceSystemId: foundation.sourceSystemId,
    competitionId: foundation.editionId,
    editionSourceId: foundation.editionSourceId,
    expectedPublicationStatus: 'DRAFT',
    requireMatchingDryRun: true,
    receiptMetadata: evidence.receiptMetadata,
  });
  const service = new CompetitionImportService(
    new JsonCompetitionAdapter(),
    {
      sourceSystemId: foundation.sourceSystemId,
      competitionId: foundation.editionId,
      ...planningState,
      allowUnresolvedMatches: true,
    },
    writer
  );
  const { normalized, preview } = await service.preview(sourceInput);

  if (!preview.valid) {
    console.log(JSON.stringify({
      mode: 'preview',
      bundlePath,
      editionId: foundation.editionId,
      valid: preview.valid,
      checksum: preview.checksum,
      issues: preview.issues,
      unresolved: preview.unresolved,
      writes: preview.writes,
      nextStep: preview.valid
        ? 'Re-run with --apply to persist this exact bundle'
        : 'Resolve every blocking issue before applying',
    }, null, 2));
    if (!preview.valid) process.exitCode = 2;
    return;
  }

  if (recordPreview) {
    const receipt = await recordPrismaImportPreview(prisma, {
      sourceSystemId: foundation.sourceSystemId,
      competitionId: foundation.editionId,
      editionSourceId: foundation.editionSourceId,
      expectedPublicationStatus: 'DRAFT',
      receiptMetadata: evidence.receiptMetadata,
    }, normalized, preview);
    console.log(JSON.stringify({
      mode: 'recorded-preview',
      bundlePath,
      editionId: foundation.editionId,
      valid: true,
      ...receipt,
      nextStep: `Re-run with --apply to persist checksum ${preview.checksum}`,
    }, null, 2));
    return;
  }

  if (!apply) {
    console.log(JSON.stringify({
      mode: 'preview',
      bundlePath,
      editionId: foundation.editionId,
      valid: true,
      checksum: preview.checksum,
      issues: preview.issues,
      unresolved: preview.unresolved,
      writes: preview.writes,
      nextStep: 'Re-run with --record-preview before --apply',
    }, null, 2));
    return;
  }

  const receipt = await service.execute(sourceInput);
  if (!receipt.publicationStatus) {
    throw new Error('Applied import receipt did not include the edition publication status');
  }
  console.log(JSON.stringify({
    mode: 'applied',
    bundlePath,
    editionId: foundation.editionId,
    ...receipt,
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
