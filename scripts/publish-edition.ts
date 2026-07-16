import { prisma } from '@/lib/db';
import { publishEdition } from '@/lib/edition-publication';

async function main() {
  const [competitionSlug, editionSlug] = process.argv.slice(2);
  if (!competitionSlug || !editionSlug) {
    throw new Error('Usage: npm run db:publish:edition -- <competition-slug> <edition-slug>');
  }

  const result = await publishEdition(prisma, { competitionSlug, editionSlug });
  console.log(JSON.stringify({ status: 'published', ...result }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
