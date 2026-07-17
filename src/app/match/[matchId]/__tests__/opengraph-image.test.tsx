import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findUniqueMock,
  imageResponseMock,
  resolvePublicMatchMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  imageResponseMock: vi.fn(),
  resolvePublicMatchMock: vi.fn(),
}));

vi.mock('next/og', () => ({
  ImageResponse: class {
    element: React.ReactElement;

    constructor(element: React.ReactElement) {
      imageResponseMock(element);
      this.element = element;
    }
  },
}));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, readFile: vi.fn().mockResolvedValue(Buffer.from('font')) };
});
vi.mock('@/lib/db', () => ({
  prisma: { match: { findUnique: findUniqueMock } },
}));
vi.mock('@/lib/public-match', () => ({
  resolvePublicMatchAccess: resolvePublicMatchMock,
  canExposePublicMatchScore: (access: { scoreAvailable: boolean }) => access.scoreAvailable,
}));

import MatchOgImage from '../opengraph-image';

const match = {
  homeTeamId: 'home',
  awayTeamId: 'away',
  round: null,
  roundLabel: 'Pool A',
  finalCode: null,
  stage: { name: 'Pool Stage' },
  venue: 'The Hydro',
  status: 'COMPLETED',
  homeScore: 60,
  awayScore: 55,
  homeTeam: { name: 'Australia', abbreviation: 'AUS', logoUrl: null },
  awayTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
};

async function renderImage() {
  const response = await MatchOgImage({ params: Promise.resolve({ matchId: 'match-1' }) });
  render((response as unknown as { element: React.ReactElement }).element);
}

describe('match Open Graph score safety', () => {
  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(match);
    resolvePublicMatchMock.mockReset().mockResolvedValue({ scoreAvailable: false });
    imageResponseMock.mockClear();
  });

  it('shows teams but not an unverified or capability-denied score', async () => {
    await renderImage();

    expect(screen.getByText('AUS')).toBeInTheDocument();
    expect(screen.getByText('ENG')).toBeInTheDocument();
    expect(screen.getByText('vs')).toBeInTheDocument();
    expect(screen.queryByText('60 - 55')).not.toBeInTheDocument();
  });

  it('shows a score only when the shared public score policy allows it', async () => {
    resolvePublicMatchMock.mockResolvedValue({ scoreAvailable: true });

    await renderImage();

    expect(screen.getByText('60 - 55')).toBeInTheDocument();
  });

  it('fails an unpublished or unpublished-stage match closed', async () => {
    resolvePublicMatchMock.mockResolvedValue(null);

    await renderImage();

    expect(screen.getByText('HOME')).toBeInTheDocument();
    expect(screen.getByText('AWAY')).toBeInTheDocument();
    expect(screen.queryByText('AUS')).not.toBeInTheDocument();
    expect(screen.queryByText('60 - 55')).not.toBeInTheDocument();
  });
});
