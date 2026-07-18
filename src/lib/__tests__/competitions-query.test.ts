import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connection: vi.fn().mockResolvedValue(undefined),
  findMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('@/lib/db', () => ({
  prisma: { competition: { findMany: mocks.findMany } },
}));

import { competitionOptionSelect, getCompetitions } from '@/lib/competitions';

describe('competition directory query', () => {
  beforeEach(() => {
    mocks.connection.mockClear();
    mocks.findMany.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the database on each request instead of retaining a CLI-stale process cache', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await getCompetitions();
    await getCompetitions();

    expect(mocks.connection).toHaveBeenCalledTimes(2);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });

  it('counts only active edition entries for the public readiness gate', () => {
    expect(competitionOptionSelect._count.select.entries).toEqual({
      where: { status: 'ACTIVE' },
    });
  });
});
