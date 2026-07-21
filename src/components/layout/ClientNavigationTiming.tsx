'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { markClientNavigationComplete } from '@/lib/client-navigation-timing';

export function ClientNavigationTiming() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    markClientNavigationComplete(pathname ?? '/');
  }, [pathname, query]);

  return null;
}
