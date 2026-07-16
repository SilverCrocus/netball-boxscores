import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { upsertGlasgow2026Foundation } from '@/lib/glasgow/edition';
import { JsonCompetitionAdapter } from '@/lib/sources/adapter';
import {
  loadPrismaImportPlanningState,
  PrismaCompetitionImportWriter,
} from '@/lib/sources/prisma-writer';
import { CompetitionImportService } from '@/lib/sources/service';

function usage(): never {
  throw new Error('Usage: npm run db:import:glasgow -- <bundle.json> [--apply]');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sourceFile = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  if (!sourceFile) usage();

  const bundlePath = path.resolve(sourceFile);
  const sourceInput = await readFile(bundlePath, 'utf8');
  const foundation = await upsertGlasgow2026Foundation(prisma);
  const planningState = await loadPrismaImportPlanningState(prisma, {
    sourceSystemId: foundation.sourceSystemId,
    competitionId: foundation.editionId,
  });
  const writer = new PrismaCompetitionImportWriter(prisma, {
    sourceSystemId: foundation.sourceSystemId,
    competitionId: foundation.editionId,
    editionSourceId: foundation.editionSourceId,
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
  const { preview } = await service.preview(sourceInput);

  if (!preview.valid || !apply) {
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

  const receipt = await service.execute(sourceInput);
  console.log(JSON.stringify({
    mode: 'applied',
    bundlePath,
    editionId: foundation.editionId,
    publicationStatus: 'DRAFT',
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
