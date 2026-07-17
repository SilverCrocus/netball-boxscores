import type { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import { notFound } from 'next/navigation';
import { GlasgowDraftPreview } from '@/components/admin/GlasgowDraftPreview';
import {
  requireGlasgowDraftPreviewAccess,
  writeDraftPreviewAudit,
} from '@/lib/draft-preview-access';
import { loadGlasgowDraftPreview } from '@/lib/glasgow/draft-preview';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Private Glasgow 2026 DRAFT Preview',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
    },
  },
};

export default async function GlasgowDraftPreviewPage() {
  noStore();
  const { userId } = await requireGlasgowDraftPreviewAccess();
  const data = await loadGlasgowDraftPreview();

  if (!data) {
    writeDraftPreviewAudit('EDITION_NOT_FOUND', userId);
    notFound();
  }

  writeDraftPreviewAudit('RENDERED', userId);
  return <GlasgowDraftPreview data={data} />;
}
