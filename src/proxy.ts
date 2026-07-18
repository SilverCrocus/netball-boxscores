import { withAuth } from 'next-auth/middleware';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { NextRequestWithAuth } from 'next-auth/middleware';

const settingsAuth = withAuth({
  pages: {
    signIn: '/auth/signin',
  },
});

const GLASGOW_DRAFT_PREVIEW_PATH = '/admin/preview/glasgow-2026';

export function privateDraftPreviewResponse(): NextResponse {
  const response = NextResponse.next();
  response.headers.set(
    'Cache-Control',
    'private, no-store, no-cache, max-age=0, must-revalidate',
  );
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (request.nextUrl.pathname === GLASGOW_DRAFT_PREVIEW_PATH) {
    return privateDraftPreviewResponse();
  }

  return settingsAuth(request as NextRequestWithAuth, event);
}

export const config = {
  matcher: ['/admin/preview/glasgow-2026', '/settings/:path*'],
};
