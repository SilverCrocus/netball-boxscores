import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  GLASGOW_2026_FOUNDATION,
  resolveGlasgow2026Foundation,
  upsertGlasgow2026Foundation,
} from '@/lib/glasgow/edition';

function foundationClient(publicationStatus: 'DRAFT' | 'PUBLISHED' = 'DRAFT') {
  const competitionUpsert = vi.fn().mockResolvedValue({
    id: 'edition-id',
    publicationStatus,
  });
  const stageUpsert = vi.fn(async ({ create }: {
    create: { slug: string; isPublished: boolean };
    update: { slug: string };
  }) => ({ id: `stage-${create.slug}`, slug: create.slug, isPublished: true }));
  const sourceSystemUpsert = vi.fn().mockResolvedValue({ id: 'source-system-id' });
  const transaction = {
    competitionSeries: { upsert: vi.fn().mockResolvedValue({ id: 'series-id' }) },
    ruleset: { upsert: vi.fn().mockResolvedValue({ id: 'ruleset-id' }) },
    competition: { upsert: competitionUpsert },
    stage: { upsert: stageUpsert },
    stageGroup: { upsert: vi.fn().mockResolvedValue({ id: 'group-id' }) },
    sourceSystem: { upsert: sourceSystemUpsert },
    editionSource: { upsert: vi.fn().mockResolvedValue({ id: 'edition-source-id' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaClient;

  return { prisma, competitionUpsert, stageUpsert, sourceSystemUpsert };
}

describe('Glasgow 2026 foundation', () => {
  it('uses a tournament edition with venue-local time and standard scoring', () => {
    expect(GLASGOW_2026_FOUNDATION.series.kind).toBe('TOURNAMENT');
    expect(GLASGOW_2026_FOUNDATION.edition.sourceTimezone).toBe('Europe/London');
    expect(GLASGOW_2026_FOUNDATION.ruleset).toMatchObject({
      periodCount: 4,
      regulationPeriodMinutes: 15,
      scoringModel: 'STANDARD',
      superShotsEnabled: false,
    });
  });

  it('defines pools and unresolved-fixture stages without publishing them', () => {
    expect(GLASGOW_2026_FOUNDATION.groups.map((group) => group.slug)).toEqual(['pool-a', 'pool-b']);
    expect(GLASGOW_2026_FOUNDATION.stages.map((stage) => stage.type)).toEqual([
      'POOL',
      'CLASSIFICATION',
      'SEMI_FINALS',
      'MEDAL_MATCHES',
    ]);
  });

  it('records the public-factual user assertion without claiming organiser approval', () => {
    expect(GLASGOW_2026_FOUNDATION.source.key).toBe('glasgow-2026-public-data');
  });

  it('keeps foundation writes scoped to a draft edition', async () => {
    const { prisma, competitionUpsert, stageUpsert, sourceSystemUpsert } = foundationClient();

    await upsertGlasgow2026Foundation(prisma);

    expect(competitionUpsert.mock.calls[0][0].update).not.toHaveProperty('publicationStatus');
    for (const call of stageUpsert.mock.calls) {
      expect(call[0].update).not.toHaveProperty('isPublished');
      expect(call[0].create).toHaveProperty('isPublished', false);
    }
    expect(sourceSystemUpsert.mock.calls[0][0].update.config).toMatchObject({
      factualDataReuse: 'PUBLIC_FACTUAL_DATA_USER_ASSERTED',
      organiserApproval: 'NOT_CLAIMED',
    });
  });

  it('rejects foundation preparation after the edition is published', async () => {
    const { prisma, stageUpsert } = foundationClient('PUBLISHED');

    await expect(upsertGlasgow2026Foundation(prisma)).rejects.toThrow(
      'Glasgow 2026 foundation preparation requires DRAFT edition status; found PUBLISHED',
    );
    expect(stageUpsert).not.toHaveBeenCalled();
  });

  it('resolves an existing foundation for read-only previews without an upsert', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'edition-source-id',
      competitionId: 'edition-id',
      sourceSystemId: 'source-system-id',
    });
    const prisma = {
      editionSource: { findFirst },
    } as unknown as PrismaClient;

    await expect(resolveGlasgow2026Foundation(prisma)).resolves.toEqual({
      editionId: 'edition-id',
      sourceSystemId: 'source-system-id',
      editionSourceId: 'edition-source-id',
    });
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it('fails a database preview clearly when the foundation is missing', async () => {
    const prisma = {
      editionSource: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    await expect(resolveGlasgow2026Foundation(prisma)).rejects.toThrow(
      'Glasgow 2026 import foundation is missing; run npm run db:prepare:glasgow first, or use --offline-preview for a database-free preview',
    );
  });
});
