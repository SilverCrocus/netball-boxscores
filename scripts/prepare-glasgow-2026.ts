import { prisma } from '@/lib/db';
import { upsertGlasgow2026Foundation } from '@/lib/glasgow/edition';
import { assertGlasgowDatabaseActionAllowed } from './lib/glasgow-production-guard';

async function main() {
  await assertGlasgowDatabaseActionAllowed('prepare');
  const result = await upsertGlasgow2026Foundation(prisma);
  console.log(JSON.stringify({
    status: 'prepared-unpublished',
    editionId: result.editionId,
    stages: Object.keys(result.stageIds),
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
