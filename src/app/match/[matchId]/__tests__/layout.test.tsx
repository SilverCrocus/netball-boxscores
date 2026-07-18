import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolvePublicMatchMock, notFoundMock } = vi.hoisted(() => ({
  resolvePublicMatchMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchForRequest: resolvePublicMatchMock,
}));

vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

import PublicMatchLayout from '../layout';

describe('PublicMatchLayout', () => {
  beforeEach(() => {
    resolvePublicMatchMock.mockReset();
    notFoundMock.mockClear();
  });

  it('renders a match belonging to a public-ready edition', async () => {
    resolvePublicMatchMock.mockResolvedValue({ id: 'match-1' });

    const result = await PublicMatchLayout({
      children: <p>Match centre</p>,
      params: Promise.resolve({ matchId: 'match-1' }),
    });

    expect(result).toEqual(<p>Match centre</p>);
    expect(resolvePublicMatchMock).toHaveBeenCalledWith('match-1');
  });

  it('returns not found for a match outside public-ready editions', async () => {
    resolvePublicMatchMock.mockResolvedValue(null);

    await expect(PublicMatchLayout({
      children: <p>Hidden match</p>,
      params: Promise.resolve({ matchId: 'draft-match' }),
    })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledOnce();
  });
});
