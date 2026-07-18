import { prisma } from '@/lib/db';
import { publishEdition } from '@/lib/edition-publication';
import { loadGlasgowFoundationSourceEvidence } from '@/lib/glasgow/source-manifest';
import { assertGlasgowDatabaseActionAllowed } from './lib/glasgow-production-guard';

async function main() {
  const args = process.argv.slice(2);
  const [competitionSlug, editionSlug] = args;
  if (!competitionSlug || !editionSlug) {
    throw new Error(
      'Usage: npm run db:publish:edition -- <competition-slug> <edition-slug> (--dry-run | --apply --confirm <token>)',
    );
  }
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun === apply) throw new Error('Choose exactly one of --dry-run or --apply');
  const confirmationIndex = args.indexOf('--confirm');
  const confirmationToken = confirmationIndex >= 0 ? args[confirmationIndex + 1] : undefined;
  if (apply && !confirmationToken) throw new Error('--apply requires --confirm <token> from --dry-run');

  const isGlasgow = competitionSlug === 'commonwealth-games-netball'
    && editionSlug === 'glasgow-2026';
  if (isGlasgow) {
    await assertGlasgowDatabaseActionAllowed(apply ? 'publish-apply' : 'publish-dry-run');
  }

  const glasgowExpectation = isGlasgow
    ? (await loadGlasgowFoundationSourceEvidence(
      'data/glasgow-2026/v1/bundle.json',
    )).publicationExpectation
    : undefined;

  const result = await publishEdition(
    prisma,
    { competitionSlug, editionSlug },
    { dryRun, confirmationToken, glasgowExpectation },
  );
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
