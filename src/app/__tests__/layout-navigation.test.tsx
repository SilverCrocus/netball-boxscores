import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPublicCompetitionNavigationDirectoryMock,
  isUpstreamPreviewModeMock,
  measureServerOperationMock,
} = vi.hoisted(() => ({
  getPublicCompetitionNavigationDirectoryMock: vi.fn(),
  isUpstreamPreviewModeMock: vi.fn(),
  measureServerOperationMock: vi.fn(
    (_route: string, _operation: string, handler: () => Promise<unknown>) => handler(),
  ),
}));

vi.mock('next/font/google', () => ({
  Lexend: () => ({ variable: 'lexend' }),
  Manrope: () => ({ variable: 'manrope' }),
  Inter: () => ({ variable: 'inter' }),
}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/competitions', () => ({
  getPublicCompetitionNavigationDirectory: getPublicCompetitionNavigationDirectoryMock,
}));
vi.mock('@/lib/upstream-preview', () => ({
  isUpstreamPreviewMode: isUpstreamPreviewModeMock,
}));
vi.mock('@/lib/server-timing', () => ({
  measureServerOperation: measureServerOperationMock,
}));

import { loadNavigationEditions } from '../layout';

describe('root navigation edition loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isUpstreamPreviewModeMock.mockReturnValue(false);
  });

  it('offers both hosted public editions without touching Prisma in upstream-preview mode', async () => {
    isUpstreamPreviewModeMock.mockReturnValue(true);

    await expect(loadNavigationEditions()).resolves.toEqual([
      expect.objectContaining({ editionLabel: 'Glasgow 2026' }),
      expect.objectContaining({
        competitionName: 'Suncorp Super Netball',
        editionLabel: '2026',
      }),
    ]);
    expect(getPublicCompetitionNavigationDirectoryMock).not.toHaveBeenCalled();
  });

  it('keeps normal navigation sourced from the publication-gated database directory', async () => {
    getPublicCompetitionNavigationDirectoryMock.mockResolvedValue([{
      id: 'published-edition',
      series: { slug: 'published-series', name: 'Published Series' },
      slug: '2026',
      label: '2026',
      season: 2026,
      sourceTimezone: 'Australia/Sydney',
    }]);

    await expect(loadNavigationEditions()).resolves.toEqual([{
      id: 'published-edition',
      competitionSlug: 'published-series',
      competitionName: 'Published Series',
      editionSlug: '2026',
      editionLabel: '2026',
      sourceTimezone: 'Australia/Sydney',
    }]);
    expect(getPublicCompetitionNavigationDirectoryMock).toHaveBeenCalledOnce();
  });
});
