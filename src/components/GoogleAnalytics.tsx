'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';

export function analyticsAllowedOnPath(pathname: string): boolean {
  return !pathname.startsWith('/admin/') && !pathname.startsWith('/auth/');
}

export function GoogleAnalytics() {
  const pathname = usePathname();
  const gaId = process.env.NEXT_PUBLIC_GA4_ID;
  if (!gaId || !analyticsAllowedOnPath(pathname)) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  );
}
