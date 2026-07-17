import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAccess, loadPreview, audit, notFound, noStore } = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  loadPreview: vi.fn(),
  audit: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NOT_FOUND'); }),
  noStore: vi.fn(),
}));

vi.mock('next/cache', () => ({ unstable_noStore: noStore }));
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/lib/draft-preview-access', () => ({
  requireGlasgowDraftPreviewAccess: requireAccess,
  writeDraftPreviewAudit: audit,
}));
vi.mock('@/lib/glasgow/draft-preview', () => ({ loadGlasgowDraftPreview: loadPreview }));
vi.mock('@/components/admin/GlasgowDraftPreview', () => ({
  GlasgowDraftPreview: ({ data }: { data: { edition: { label: string } } }) => <div>{data.edition.label}</div>,
}));

import GlasgowDraftPreviewPage, { dynamic, metadata, revalidate } from './page';

describe('GlasgowDraftPreviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccess.mockResolvedValue({ userId: 'operator-1' });
    loadPreview.mockResolvedValue({ edition: { label: 'Glasgow 2026' } });
  });

  it('authorizes before invoking the fresh loader and renders an allowlisted request', async () => {
    const page = await GlasgowDraftPreviewPage();
    render(page);

    expect(noStore).toHaveBeenCalledOnce();
    expect(requireAccess.mock.invocationCallOrder[0]).toBeLessThan(loadPreview.mock.invocationCallOrder[0]);
    expect(screen.getByText('Glasgow 2026')).toBeInTheDocument();
    expect(audit).toHaveBeenCalledWith('RENDERED', 'operator-1');
  });

  it('never invokes the preview loader when access is denied', async () => {
    requireAccess.mockRejectedValueOnce(new Error('NOT_FOUND'));
    await expect(GlasgowDraftPreviewPage()).rejects.toThrow('NOT_FOUND');
    expect(loadPreview).not.toHaveBeenCalled();
  });

  it('404s if the exact DRAFT edition is absent', async () => {
    loadPreview.mockResolvedValueOnce(null);
    await expect(GlasgowDraftPreviewPage()).rejects.toThrow('NOT_FOUND');
    expect(audit).toHaveBeenCalledWith('EDITION_NOT_FOUND', 'operator-1');
  });

  it('is force-dynamic, uncached and non-indexable', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(revalidate).toBe(0);
    expect(metadata.robots).toMatchObject({ index: false, follow: false, noarchive: true });
  });
});
