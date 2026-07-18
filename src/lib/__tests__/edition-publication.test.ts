import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateEditionPublicationReadiness,
  publishEdition,
  unpublishEdition,
  type EditionStagePublicationReadinessInput,
} from '@/lib/edition-publication';
import type { GlasgowPublicationExpectation } from '@/lib/glasgow/source-manifest';

const identity = {
  competitionSlug: 'commonwealth-games-netball',
  editionSlug: 'glasgow-2026',
};

const glasgowStages: EditionStagePublicationReadinessInput[] = [
  { slug: 'pool-stage', type: 'POOL', sequence: 1, isPublished: false, groupCount: 2, matchCount: 30 },
  { slug: 'classification', type: 'CLASSIFICATION', sequence: 2, isPublished: false, groupCount: 0, matchCount: 4 },
  { slug: 'semi-finals', type: 'SEMI_FINALS', sequence: 3, isPublished: false, groupCount: 0, matchCount: 2 },
  { slug: 'medal-matches', type: 'MEDAL_MATCHES', sequence: 4, isPublished: false, groupCount: 0, matchCount: 2 },
];

const expectation: GlasgowPublicationExpectation = {
  importChecksum: 'bundle-checksum',
  bundleFileSha256: 'bundle-file-sha',
  manifestFileSha256: 'manifest-file-sha',
  sourceIds: ['source-one'],
  sources: [{
    id: 'source-one',
    url: 'https://example.com/source-one',
    retrievedAt: '2026-07-17T00:00:00.000Z',
    fetchStatus: 'REFERENCED',
  }],
  teamExternalIds: Array.from({ length: 12 }, (_, index) => `team-${index + 1}`),
  playerExternalIds: Array.from({ length: 96 }, (_, index) => `player-${index + 1}`),
  matchExternalIds: Array.from({ length: 38 }, (_, index) => `match-${index + 1}`),
  canonicalPlayers: [{ externalId: 'player-1', championDataPlayerId: 101 }],
  editionCoverage: [
    'FINAL_SCORE',
    'PERIOD_SCORES',
    'TEAM_BOX_SCORE',
    'PLAYER_BOX_SCORE',
    'SCORE_FLOW',
    'MATCH_EVENTS',
    'SUBSTITUTIONS',
    'NET_POINTS',
    'SUPER_SHOTS',
    'LINEUPS',
  ].map((capability) => ({ capability, state: 'UNAVAILABLE' })),
};

function publicationClient(input: {
  publicationStatus?: 'DRAFT' | 'PUBLISHED';
  entries?: number;
  matches?: number;
  slots?: number;
  rosters?: number;
  openIssues?: number;
  appliedChecksum?: string;
  dryRunChecksum?: string;
  provenanceComplete?: boolean;
  mappingsComplete?: boolean;
  coverageComplete?: boolean;
} = {}) {
  const update = vi.fn().mockReturnValue({ operation: 'update-edition' });
  const updateMany = vi.fn().mockReturnValue({ operation: 'update-stages' });
  const transaction = vi.fn().mockResolvedValue([]);
  const mappings = [
    ...expectation.teamExternalIds.map((externalId) => ({
      entityType: 'TEAM', externalId, internalEntityId: `internal-${externalId}`,
    })),
    ...expectation.playerExternalIds.map((externalId) => ({
      entityType: 'PLAYER', externalId, internalEntityId: `internal-${externalId}`,
    })),
    ...expectation.matchExternalIds.map((externalId) => ({
      entityType: 'MATCH', externalId, internalEntityId: `internal-${externalId}`,
    })),
  ];
  if (input.mappingsComplete === false) mappings.pop();
  const receiptManifest = input.provenanceComplete === false
    ? { bundleFileSha256: 'wrong' }
    : {
      bundleFileSha256: expectation.bundleFileSha256,
      manifestFileSha256: expectation.manifestFileSha256,
      sourceCount: expectation.sourceIds.length,
      sourceIds: expectation.sourceIds,
      publicationStatusPolicy: 'DRAFT_ONLY',
    };
  const runs = [
    {
      id: 'applied-run',
      dryRun: false,
      checksum: input.appliedChecksum ?? expectation.importChecksum,
      completedAt: new Date('2026-07-16T02:00:00Z'),
      metadata: { importKind: 'GLASGOW_FOUNDATION', sourceManifest: receiptManifest },
    },
    {
      id: 'dry-run',
      dryRun: true,
      checksum: input.dryRunChecksum ?? expectation.importChecksum,
      completedAt: new Date('2026-07-16T01:00:00Z'),
      metadata: { importKind: 'GLASGOW_FOUNDATION', sourceManifest: receiptManifest },
    },
  ];
  const coverage = expectation.editionCoverage.map((item) => ({ ...item }));
  if (input.coverageComplete === false) coverage.pop();
  const client = {
    competition: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'glasgow-edition',
        name: 'Glasgow 2026 Netball',
        publicationStatus: input.publicationStatus ?? 'DRAFT',
        _count: { entries: input.entries ?? 12, matches: input.matches ?? 38 },
        stages: glasgowStages.map((stage) => ({
          slug: stage.slug,
          type: stage.type,
          sequence: stage.sequence,
          isPublished: stage.isPublished,
          _count: { groups: stage.groupCount, matches: stage.matchCount },
        })),
      }),
      update,
    },
    stage: { updateMany },
    sourceSystem: { findUnique: vi.fn().mockResolvedValue({ id: 'source-id' }) },
    matchSlot: { count: vi.fn().mockResolvedValue(input.slots ?? 76) },
    rosterMembership: { count: vi.fn().mockResolvedValue(input.rosters ?? 96) },
    importRun: { findMany: vi.fn().mockResolvedValue(runs) },
    sourceEntityMapping: { findMany: vi.fn().mockResolvedValue(mappings) },
    player: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'internal-player-1', championDataPlayerId: 101 },
      ]),
    },
    dataCoverage: { findMany: vi.fn().mockResolvedValue(coverage) },
    importIssue: { count: vi.fn().mockResolvedValue(input.openIssues ?? 0) },
    $transaction: transaction,
  } as unknown as PrismaClient;
  return { client, update, updateMany, transaction };
}

describe('publishEdition', () => {
  it('requires every Glasgow launch invariant, not just teams and matches', () => {
    const readiness = evaluateEditionPublicationReadiness({
      competitionSlug: identity.competitionSlug,
      editionSlug: identity.editionSlug,
      publicationStatus: 'PUBLISHED',
      teamCount: 12,
      matchCount: 38,
      matchSlotCount: 76,
      activeRosterCount: 95,
      cleanSuccessfulImportCount: 1,
      expectedImportChecksum: 'expected',
      latestAppliedImportChecksum: 'stale',
      latestCleanDryRunChecksum: null,
      sourceMappingsComplete: false,
      provenanceComplete: false,
      coverageComplete: false,
      unresolvedValidationIssueCount: 2,
      stages: glasgowStages,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'Glasgow 2026 requires exactly 96 active roster memberships; found 95',
      'Glasgow 2026 publication requires DRAFT status; found PUBLISHED',
      'Glasgow 2026 latest applied foundation import must match the expected bundle checksum',
      'Glasgow 2026 requires a clean recorded dry-run for the expected bundle checksum',
      'Glasgow 2026 source mappings or reviewed canonical player mappings are incomplete',
      'Glasgow 2026 latest applied receipt does not match the expected source manifest',
      'Glasgow 2026 edition coverage does not match the expected source declaration',
      'Glasgow 2026 has 2 unresolved validation issues',
    ]));
  });

  it('returns a dry-run token and requires that exact token before publishing', async () => {
    const { client, update, updateMany, transaction } = publicationClient();
    const dryRun = await publishEdition(client, identity, {
      dryRun: true,
      glasgowExpectation: expectation,
    });
    expect(dryRun).toMatchObject({ status: 'ready', dryRun: true, activeRosterCount: 96 });
    expect(dryRun.confirmationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(transaction).not.toHaveBeenCalled();

    await expect(publishEdition(client, identity, {
      dryRun: false,
      confirmationToken: 'wrong',
      glasgowExpectation: expectation,
    })).rejects.toThrow('confirmation token does not match');
    expect(update).not.toHaveBeenCalled();

    const published = await publishEdition(client, identity, {
      dryRun: false,
      confirmationToken: dryRun.confirmationToken!,
      glasgowExpectation: expectation,
    });
    expect(published).toMatchObject({ status: 'published', dryRun: false });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ publicationStatus: 'PUBLISHED' }),
    }));
    expect(updateMany).toHaveBeenCalledWith({
      where: { competitionId: 'glasgow-edition' },
      data: { isPublished: true },
    });
  });

  it('blocks stale checksums, incomplete provenance, coverage, mappings, or rosters', async () => {
    const { client } = publicationClient({
      rosters: 95,
      appliedChecksum: 'stale',
      dryRunChecksum: 'stale',
      provenanceComplete: false,
      mappingsComplete: false,
      coverageComplete: false,
      openIssues: 1,
    });
    await expect(publishEdition(client, identity, {
      dryRun: true,
      glasgowExpectation: expectation,
    })).rejects.toThrow('Edition is not publication-ready');
  });

  it('keeps the generic gate suitable for non-Glasgow editions', () => {
    expect(evaluateEditionPublicationReadiness({
      competitionSlug: 'suncorp-super-netball',
      editionSlug: '2026',
      publicationStatus: 'DRAFT',
      teamCount: 2,
      matchCount: 1,
    })).toEqual({ ready: true, blockers: [] });
  });
});

describe('unpublishEdition', () => {
  it('atomically returns a published edition to draft without deleting imported data', async () => {
    const { client, update, updateMany, transaction } = publicationClient({ publicationStatus: 'PUBLISHED' });
    const result = await unpublishEdition(client, identity);

    expect(result).toMatchObject({ status: 'DRAFT', changed: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'glasgow-edition' },
      data: { publicationStatus: 'DRAFT', publishedAt: null },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { competitionId: 'glasgow-edition' },
      data: { isPublished: false },
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(client).not.toHaveProperty('delete');
  });
});
