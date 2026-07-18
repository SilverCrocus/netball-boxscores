import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db';
import {
  GlasgowResultsImportService,
  type GlasgowResultsImportInput,
} from '@/lib/glasgow/results-import';
import { assertGlasgowDatabaseActionAllowed } from './lib/glasgow-production-guard';

function usage(): never {
  throw new Error(
    'Usage: npm run db:import:glasgow:results -- <results.json> [--record-preview|--apply --confirm <token>]',
  );
}

async function main() {
  const args = process.argv.slice(2);
  const sourceFile = args[0] && !args[0].startsWith('--') ? args[0] : null;
  if (!sourceFile) usage();
  const recordPreview = args.includes('--record-preview');
  const apply = args.includes('--apply');
  if (recordPreview && apply) throw new Error('--record-preview cannot be combined with --apply');
  const confirmationIndex = args.indexOf('--confirm');
  const confirmation = confirmationIndex >= 0 ? args[confirmationIndex + 1] : undefined;
  if (apply && !confirmation) throw new Error('--apply requires --confirm <token> from a recorded preview');
  if (!apply && confirmation) throw new Error('--confirm is only valid with --apply');

  await assertGlasgowDatabaseActionAllowed(
    recordPreview ? 'results-record-preview' : apply ? 'results-apply' : 'results-preview',
  );

  const sourcePath = path.resolve(sourceFile);
  const input = JSON.parse(await readFile(sourcePath, 'utf8')) as GlasgowResultsImportInput;
  const service = new GlasgowResultsImportService(prisma);

  if (recordPreview) {
    const result = await service.recordPreview(input);
    console.log(JSON.stringify({
      mode: 'recorded-preview',
      sourcePath,
      ...result,
      nextStep: `Re-run with --apply --confirm ${result.preview.confirmationToken}`,
    }, null, 2));
    return;
  }
  if (apply) {
    const receipt = await service.apply(input, confirmation!);
    console.log(JSON.stringify({ mode: 'applied', sourcePath, ...receipt }, null, 2));
    return;
  }

  const preview = await service.preview(input);
  console.log(JSON.stringify({
    mode: 'preview',
    sourcePath,
    ...preview,
    nextStep: preview.valid
      ? 'Re-run with --record-preview before applying this exact file'
      : 'Resolve every blocking issue before recording a preview',
  }, null, 2));
  if (!preview.valid) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
