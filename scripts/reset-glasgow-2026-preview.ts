import { prisma } from '@/lib/db';
import { unpublishEdition } from '@/lib/edition-publication';

const COMPETITION_SERIES_SLUG = 'commonwealth-games-netball';
const EDITION_SLUG = 'glasgow-2026';
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Glasgow preview reset requires ${name}`);
  return value;
}

async function main() {
  if (process.env.DATABASE_ENVIRONMENT !== 'staging') {
    throw new Error('Glasgow preview reset requires DATABASE_ENVIRONMENT=staging');
  }
  if (process.env.WORKER_ENABLED !== 'false') {
    throw new Error('Glasgow preview reset requires WORKER_ENABLED=false');
  }
  if (process.env.ALLOW_SHARED_PRODUCTION_DB_WRITES !== 'false') {
    throw new Error('Glasgow preview reset requires ALLOW_SHARED_PRODUCTION_DB_WRITES=false');
  }

  const databaseUrl = requiredEnvironment('DATABASE_URL');
  const expectedPreviewRef = requiredEnvironment('EXPECTED_PREVIEW_PROJECT_REF');
  const productionRef = requiredEnvironment('PRODUCTION_PROJECT_REF');
  if (!PROJECT_REF_PATTERN.test(expectedPreviewRef) || !PROJECT_REF_PATTERN.test(productionRef)) {
    throw new Error('Glasgow preview reset requires valid Supabase project refs');
  }
  if (expectedPreviewRef === productionRef) {
    throw new Error('Glasgow preview reset rejected a production-equivalent target');
  }
  if (!databaseUrl.includes(expectedPreviewRef) || databaseUrl.includes(productionRef)) {
    throw new Error('Glasgow preview reset database target failed the project-ref guard');
  }

  const existing = await prisma.competition.findFirst({
    where: {
      series: { slug: COMPETITION_SERIES_SLUG },
      slug: EDITION_SLUG,
    },
    select: { id: true },
  });
  if (!existing) {
    console.log(JSON.stringify({
      status: 'no-existing-edition',
      changed: false,
    }));
    return;
  }

  const result = await unpublishEdition(prisma, {
    competitionSlug: COMPETITION_SERIES_SLUG,
    editionSlug: EDITION_SLUG,
  });
  const verified = await prisma.competition.findUnique({
    where: { id: existing.id },
    select: {
      publicationStatus: true,
      publishedAt: true,
      stages: { select: { isPublished: true } },
    },
  });
  if (
    !verified
    || verified.publicationStatus !== 'DRAFT'
    || verified.publishedAt !== null
    || verified.stages.some((stage) => stage.isPublished)
  ) {
    throw new Error('Glasgow preview reset could not verify the DRAFT/unpublished state');
  }

  console.log(JSON.stringify({
    status: 'draft-preview-reset',
    editionId: existing.id,
    changed: result.changed,
    publishedStages: 0,
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
