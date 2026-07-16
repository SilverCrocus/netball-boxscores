import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMatchMock, notFoundMock } = vi.hoisted(() => ({
  findMatchMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/db', () => ({
  prisma: { match: { findFirst: findMatchMock } },
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn().mockResolvedValue([{ id: 'ssn-2026' }]),
}));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

import PublicMatchLayout from '../layout';

describe('PublicMatchLayout', () => {
  beforeEach(() => {
    findMatchMock.mockReset();
    notFoundMock.mockClear();
  });

  it('renders a match belonging to a public-ready edition', async () => {
    findMatchMock.mockResolvedValue({ id: 'match-1' });

    const result = await PublicMatchLayout({
      children: <p>Match centre</p>,
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(result).toEqual(<p>Match centre</p>);
    expect(findMatchMock).toHaveBeenCalledWith({
      where: { id: 'match-1', competitionId: { in: ['ssn-2026'] } },
      select: { id: true },
    });
  });

  it('returns not found for a match outside public-ready editions', async () => {
    findMatchMock.mockResolvedValue(null);

    await expect(PublicMatchLayout({
      children: <p>Hidden match</p>,
      params: Promise.resolve({ matchId: 'draft-match' }),
    })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
