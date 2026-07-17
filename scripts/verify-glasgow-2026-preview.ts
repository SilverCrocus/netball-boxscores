import { prisma } from '@/lib/db';
import { loadGlasgowFoundationSourceEvidence } from '@/lib/glasgow/source-manifest';

const COMPETITION_SERIES_SLUG = 'commonwealth-games-netball';
const EDITION_SLUG = 'glasgow-2026';
const SOURCE_KEY = 'glasgow-2026-public-data';

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Glasgow preview reconciliation failed: ${message}`);
}

function receiptKind(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).importKind;
  return typeof value === 'string' ? value : null;
}

async function main() {
  invariant(process.env.DATABASE_ENVIRONMENT === 'staging', 'DATABASE_ENVIRONMENT must be staging');
  invariant(process.env.ALLOW_SHARED_PRODUCTION_DB_WRITES === 'false', 'shared production writes must be disabled');

  const evidence = await loadGlasgowFoundationSourceEvidence(
    'data/glasgow-2026/v1/bundle.json',
  );
  const expectation = evidence.publicationExpectation;
  const bundle = JSON.parse(evidence.bundleText) as {
    players: Array<{
      externalId: string;
      photoUrl?: string;
      photoSourceUrl?: string;
      photoCredit?: string;
      photoLicense?: string;
      photoVerifiedAt?: string;
    }>;
  };
  const edition = await prisma.competition.findFirst({
    where: {
      series: { slug: COMPETITION_SERIES_SLUG },
      slug: EDITION_SLUG,
    },
    select: {
      id: true,
      publicationStatus: true,
      publishedAt: true,
      stages: {
        orderBy: { sequence: 'asc' },
        select: {
          slug: true,
          isPublished: true,
          _count: { select: { groups: true, matches: true } },
        },
      },
    },
  });
  invariant(edition, 'edition is missing');
  invariant(edition.publicationStatus === 'DRAFT', `edition status is ${edition.publicationStatus}`);
  invariant(edition.publishedAt === null, 'publishedAt must remain null');
  invariant(edition.stages.length === 4, `expected 4 stages, found ${edition.stages.length}`);
  invariant(edition.stages.every((stage) => !stage.isPublished), 'all stages must remain unpublished');

  const source = await prisma.sourceSystem.findUnique({
    where: { key: SOURCE_KEY },
    select: { id: true },
  });
  invariant(source, 'source system is missing');

  const [
    activeEntryCount,
    matchCount,
    slotCount,
    activeRosterCount,
    mappings,
    coverage,
    runs,
    snapshotCount,
    openErrorCount,
  ] = await Promise.all([
    prisma.editionEntry.count({
      where: { competitionId: edition.id, status: 'ACTIVE' },
    }),
    prisma.match.count({ where: { competitionId: edition.id } }),
    prisma.matchSlot.count({ where: { match: { competitionId: edition.id } } }),
    prisma.rosterMembership.count({
      where: {
        editionEntry: { competitionId: edition.id },
        status: 'ACTIVE',
        validTo: null,
      },
    }),
    prisma.sourceEntityMapping.findMany({
      where: {
        sourceSystemId: source.id,
        competitionId: edition.id,
        entityType: { in: ['TEAM', 'PLAYER', 'MATCH'] },
      },
      select: { entityType: true, externalId: true, internalEntityId: true },
    }),
    prisma.dataCoverage.findMany({
      where: {
        sourceSystemId: source.id,
        competitionId: edition.id,
        matchId: null,
      },
      select: { capability: true, state: true },
    }),
    prisma.importRun.findMany({
      where: {
        sourceSystemId: source.id,
        competitionId: edition.id,
        checksum: expectation.importChecksum,
        status: 'SUCCEEDED',
        issueCount: 0,
      },
      select: {
        dryRun: true,
        trigger: true,
        checksum: true,
        insertedCount: true,
        updatedCount: true,
        skippedCount: true,
        metadata: true,
      },
    }),
    prisma.sourceSnapshot.count({
      where: {
        sourceSystemId: source.id,
        competitionId: edition.id,
        checksum: expectation.importChecksum,
      },
    }),
    prisma.importIssue.count({
      where: {
        importRun: { sourceSystemId: source.id, competitionId: edition.id },
        severity: 'ERROR',
        status: 'OPEN',
      },
    }),
  ]);

  invariant(activeEntryCount === 12, `expected 12 active entries, found ${activeEntryCount}`);
  invariant(matchCount === 38, `expected 38 matches, found ${matchCount}`);
  invariant(slotCount === 76, `expected 76 match slots, found ${slotCount}`);
  invariant(activeRosterCount === 96, `expected 96 active roster rows, found ${activeRosterCount}`);
  invariant(openErrorCount === 0, `found ${openErrorCount} open import errors`);

  const stageMatchCounts = Object.fromEntries(
    edition.stages.map((stage) => [stage.slug, stage._count.matches]),
  );
  invariant(stageMatchCounts['pool-stage'] === 30, 'pool-stage must contain 30 matches');
  invariant(stageMatchCounts.classification === 4, 'classification must contain 4 matches');
  invariant(stageMatchCounts['semi-finals'] === 2, 'semi-finals must contain 2 matches');
  invariant(stageMatchCounts['medal-matches'] === 2, 'medal-matches must contain 2 matches');
  invariant(
    edition.stages.find((stage) => stage.slug === 'pool-stage')?._count.groups === 2,
    'pool stage must contain two groups',
  );

  const mappingCounts = Object.groupBy(mappings, (mapping) => mapping.entityType);
  invariant(mappingCounts.TEAM?.length === 12, `expected 12 team mappings, found ${mappingCounts.TEAM?.length ?? 0}`);
  invariant(mappingCounts.PLAYER?.length === 96, `expected 96 player mappings, found ${mappingCounts.PLAYER?.length ?? 0}`);
  invariant(mappingCounts.MATCH?.length === 38, `expected 38 match mappings, found ${mappingCounts.MATCH?.length ?? 0}`);
  invariant(mappings.length === 146, `expected 146 mappings, found ${mappings.length}`);
  invariant(
    new Set(mappings.map((mapping) => `${mapping.entityType}:${mapping.externalId}`)).size === mappings.length,
    'source mappings contain duplicate external identities',
  );
  invariant(
    new Set(mappings.map((mapping) => `${mapping.entityType}:${mapping.internalEntityId}`)).size === mappings.length,
    'source mappings contain duplicate internal identities',
  );

  const expectedCoverage = expectation.editionCoverage
    .map((item) => `${item.capability}:${item.state}`)
    .toSorted();
  const actualCoverage = coverage
    .map((item) => `${item.capability}:${item.state}`)
    .toSorted();
  invariant(
    JSON.stringify(actualCoverage) === JSON.stringify(expectedCoverage),
    'edition coverage does not match the source manifest',
  );
  invariant(coverage.length === 10, `expected 10 edition coverage rows, found ${coverage.length}`);

  const playerMappings = new Map(
    mappings
      .filter((mapping) => mapping.entityType === 'PLAYER')
      .map((mapping) => [mapping.externalId, mapping.internalEntityId]),
  );
  const mappedPlayers = await prisma.player.findMany({
    where: { id: { in: [...playerMappings.values()] } },
    select: {
      id: true,
      championDataPlayerId: true,
      photoUrl: true,
      photoSourceUrl: true,
      photoCredit: true,
      photoLicense: true,
      photoVerifiedAt: true,
    },
  });
  const playerById = new Map(mappedPlayers.map((player) => [player.id, player]));
  invariant(mappedPlayers.length === 96, `expected 96 mapped players, found ${mappedPlayers.length}`);
  for (const canonical of expectation.canonicalPlayers) {
    const internalId = playerMappings.get(canonical.externalId);
    invariant(internalId, `canonical mapping is missing for ${canonical.externalId}`);
    invariant(
      playerById.get(internalId)?.championDataPlayerId === canonical.championDataPlayerId,
      `canonical mapping is incorrect for ${canonical.externalId}`,
    );
  }
  invariant(expectation.canonicalPlayers.length === 23, 'expected 23 reviewed canonical-player links');

  const expectedPhotos = bundle.players.filter((player) => player.photoUrl);
  invariant(expectedPhotos.length === 4, `expected 4 reusable photos in the bundle, found ${expectedPhotos.length}`);
  for (const expectedPhoto of expectedPhotos) {
    const internalId = playerMappings.get(expectedPhoto.externalId);
    invariant(internalId, `photo mapping is missing for ${expectedPhoto.externalId}`);
    const actualPhoto = playerById.get(internalId);
    invariant(actualPhoto, `mapped player is missing for ${expectedPhoto.externalId}`);
    invariant(actualPhoto.photoUrl === expectedPhoto.photoUrl, `photo URL is incorrect for ${expectedPhoto.externalId}`);
    invariant(
      actualPhoto.photoSourceUrl === expectedPhoto.photoSourceUrl
      && actualPhoto.photoCredit === expectedPhoto.photoCredit
      && actualPhoto.photoLicense === expectedPhoto.photoLicense
      && actualPhoto.photoVerifiedAt?.toISOString() === expectedPhoto.photoVerifiedAt,
      `photo provenance is incorrect for ${expectedPhoto.externalId}`,
    );
  }

  const foundationRuns = runs.filter((run) => receiptKind(run.metadata) === 'GLASGOW_FOUNDATION');
  invariant(foundationRuns.some((run) => run.dryRun), 'recorded clean dry-run receipt is missing');
  invariant(
    foundationRuns.some((run) => !run.dryRun && run.trigger !== 'REPLAY'),
    'initial applied import receipt is missing',
  );
  invariant(
    foundationRuns.some((run) => (
      !run.dryRun
      && run.trigger === 'REPLAY'
      && run.insertedCount === 0
      && run.updatedCount === 0
      && run.skippedCount > 0
    )),
    'idempotent replay receipt is missing',
  );
  invariant(snapshotCount === 1, `expected one deduplicated source snapshot, found ${snapshotCount}`);

  console.log(JSON.stringify({
    status: 'reconciled-draft-preview',
    editionId: edition.id,
    checksum: expectation.importChecksum,
    entries: activeEntryCount,
    pools: 2,
    matches: matchCount,
    matchSlots: slotCount,
    activeRosterMemberships: activeRosterCount,
    reviewedCanonicalPlayers: expectation.canonicalPlayers.length,
    sourceMappings: mappings.length,
    coverageRows: coverage.length,
    sourceCount: expectation.sourceIds.length,
    reusablePhotos: expectedPhotos.length,
    publishedStages: 0,
    publicationStatus: edition.publicationStatus,
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
