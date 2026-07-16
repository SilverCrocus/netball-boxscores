import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { publishEdition } from '@/lib/edition-publication';

const identity = {
  competitionSlug: 'commonwealth-games-netball',
  editionSlug: 'glasgow-2026',
};
const publishableIdentity = {
  competitionSlug: 'commonwealth-games-netball',
  editionSlug: 'sydney-2027',
};

function publicationClient(input: { entries: number; matches: number }) {
  const update = vi.fn().mockReturnValue({ operation: 'publish-edition' });
  const updateMany = vi.fn().mockReturnValue({ operation: 'publish-stages' });
  const transaction = vi.fn().mockResolvedValue([]);
  const client = {
    competition: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'glasgow-edition',
        name: 'Glasgow 2026 Netball',
        publicationStatus: 'DRAFT',
        _count: input,
      }),
      update,
    },
    stage: { updateMany },
    $transaction: transaction,
  } as unknown as PrismaClient;

  return { client, update, updateMany, transaction };
}

describe('publishEdition', () => {
  it('does not write when teams or matches are missing', async () => {
    const { client, update, updateMany, transaction } = publicationClient({ entries: 0, matches: 0 });

    await expect(publishEdition(client, identity)).rejects.toThrow(
      'Edition is not publication-ready: requires at least 2 participating teams; found 0; requires at least 1 match; found 0',
    );
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('blocks Glasgow until match labels and reused-photo attribution are safe on every public surface', async () => {
    const { client, update, updateMany, transaction } = publicationClient({ entries: 12, matches: 38 });

    await expect(publishEdition(client, identity)).rejects.toThrow(
      'Glasgow pool-stage public surfaces must render roundLabel or stage context before publication; Glasgow reused-photo thumbnails and Open Graph images require user-visible attribution before publication',
    );
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('publishes an imported edition without outstanding edition-specific blockers in one transaction', async () => {
    const { client, update, updateMany, transaction } = publicationClient({ entries: 12, matches: 38 });

    const result = await publishEdition(client, publishableIdentity);

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
});
