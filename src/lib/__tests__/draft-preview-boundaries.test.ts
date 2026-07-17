import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import robots from '@/app/robots';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('private DRAFT preview boundaries', () => {
  it('sets private no-store and crawler-denial headers only on the fixed route', async () => {
    const headers = await nextConfig.headers?.();
    const preview = headers?.find((entry) => entry.source === '/admin/preview/glasgow-2026');
    expect(preview?.headers).toEqual(expect.arrayContaining([
      { key: 'Cache-Control', value: 'private, no-store, no-cache, max-age=0, must-revalidate' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    ]));
    expect(headers?.filter((entry) => entry.source === '/admin/preview/glasgow-2026')).toHaveLength(1);
  });

  it('disallows the complete admin prefix in robots', () => {
    expect(robots().rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ disallow: expect.arrayContaining(['/admin/']) }),
    ]));
  });

  it('does not add the private route to public resolvers, sitemap or navigation', () => {
    for (const file of [
      'src/lib/competitions.ts',
      'src/app/sitemap.ts',
      'src/components/layout/Sidebar.tsx',
      'src/components/layout/BottomNav.tsx',
    ]) {
      expect(read(file)).not.toContain('/admin/preview/glasgow-2026');
      expect(read(file)).not.toContain('loadGlasgowDraftPreview');
    }
    expect(read('src/lib/competitions.ts')).toContain("edition.publicationStatus === 'PUBLISHED'");
  });
});
