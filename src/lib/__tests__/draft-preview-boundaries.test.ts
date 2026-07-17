import type { NextFetchEvent } from 'next/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import proxy, { config } from '@/proxy';

describe('private DRAFT preview boundaries', () => {
  it('applies privacy and crawler headers at the executable Next response boundary', async () => {
    const request = new NextRequest('https://centrepass.test/admin/preview/glasgow-2026');
    const response = await proxy(request, {} as NextFetchEvent);

    expect(response?.headers.get('Cache-Control')).toBe(
      'private, no-store, no-cache, max-age=0, must-revalidate',
    );
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
    expect(response?.headers.get('x-middleware-next')).toBe('1');
    expect(config.matcher).toContain('/admin/preview/glasgow-2026');
  });

  it('disallows the complete admin prefix in robots', () => {
    expect(robots().rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ disallow: expect.arrayContaining(['/admin/']) }),
    ]));
  });

});
