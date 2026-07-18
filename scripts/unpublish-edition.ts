import { prisma } from '@/lib/db';
import { unpublishEdition } from '@/lib/edition-publication';

async function main() {
  const [competitionSlug, editionSlug, confirmation] = process.argv.slice(2);
  if (!competitionSlug || !editionSlug || confirmation !== '--confirm-unpublish') {
    throw new Error(
      'Usage: npm run db:unpublish:edition -- <competition-slug> <edition-slug> --confirm-unpublish',
    );
  }

  const result = await unpublishEdition(prisma, { competitionSlug, editionSlug });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
