import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluateEditionPublicationReadiness,
  publishEdition,
  type EditionStagePublicationReadinessInput,
} from '@/lib/edition-publication';

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

function publicationClient(input: {
  entries: number;
  matches: number;
  slots?: number;
  cleanImports?: number;
  stages?: EditionStagePublicationReadinessInput[];
}) {
  const update = vi.fn().mockReturnValue({ operation: 'publish-edition' });
  const updateMany = vi.fn().mockReturnValue({ operation: 'publish-stages' });
  const transaction = vi.fn().mockResolvedValue([]);
  const client = {
    competition: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'glasgow-edition',
        name: 'Glasgow 2026 Netball',
        publicationStatus: 'DRAFT',
        _count: { entries: input.entries, matches: input.matches },
        stages: (input.stages ?? glasgowStages).map((stage) => ({
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
    matchSlot: { count: vi.fn().mockResolvedValue(input.slots ?? 76) },
    importRun: { count: vi.fn().mockResolvedValue(input.cleanImports ?? 1) },
    $transaction: transaction,
  } as unknown as PrismaClient;

  return { client, update, updateMany, transaction };
}

describe('publishEdition', () => {
  it('does not write when teams or matches are missing', async () => {
    const { client, update, updateMany, transaction } = publicationClient({
      entries: 0,
      matches: 0,
      slots: 0,
      cleanImports: 0,
      stages: [],
    });

    await expect(publishEdition(client, identity)).rejects.toThrow(
      'Edition is not publication-ready: Glasgow 2026 requires exactly 12 participating teams; found 0',
    );
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('publishes Glasgow when its imported structure passes the publication checks', async () => {
    const { client, update, updateMany, transaction } = publicationClient({
      entries: 12,
      matches: 38,
    });

    const result = await publishEdition(client, identity);

    expect(result).toMatchObject({
      editionId: 'glasgow-edition',
      teamCount: 12,
      matchCount: 38,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'glasgow-edition' },
      data: expect.objectContaining({ publicationStatus: 'PUBLISHED' }),
    }));
    expect(updateMany).toHaveBeenCalledWith({
      where: { competitionId: 'glasgow-edition' },
      data: { isPublished: true },
    });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('blocks Glasgow when slots, stage structure, or a clean applied import are incomplete', async () => {
    const { client } = publicationClient({
      entries: 12,
      matches: 38,
      slots: 75,
      cleanImports: 0,
      stages: glasgowStages.map((stage) => stage.slug === 'pool-stage'
        ? { ...stage, matchCount: 29 }
        : stage),
    });

    await expect(publishEdition(client, identity)).rejects.toThrow(
      'Glasgow 2026 requires exactly 76 match slots; found 75; Glasgow 2026 requires a successful applied import with no recorded issues; Glasgow 2026 stage pool-stage must be POOL at sequence 1 with 2 groups and 30 matches',
    );
  });

  it('requires published Glasgow stages when evaluating an already-public edition', () => {
    expect(evaluateEditionPublicationReadiness({
      competitionSlug: identity.competitionSlug,
      editionSlug: identity.editionSlug,
      publicationStatus: 'PUBLISHED',
      teamCount: 12,
      matchCount: 38,
      matchSlotCount: 76,
      cleanSuccessfulImportCount: 1,
      stages: glasgowStages,
    })).toMatchObject({
      ready: false,
      blockers: expect.arrayContaining([
        'Glasgow 2026 stage pool-stage must be published',
        'Glasgow 2026 stage medal-matches must be published',
      ]),
    });
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
