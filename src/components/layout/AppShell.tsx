'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { ClientNavigationTiming } from './ClientNavigationTiming';
import { LandingHeader } from './LandingHeader';
import { GlobalEditionSelector } from '@/components/competition/GlobalEditionSelector';
import type { EditionContextValue } from '@/lib/edition-context';

interface AppShellProps {
  children: React.ReactNode;
  editions?: EditionContextValue[];
  analyticsEnabled?: boolean;
  askCentrePassEnabled?: boolean;
}

export function AppShell({
  children,
  editions = [],
  analyticsEnabled = false,
  askCentrePassEnabled = false,
}: AppShellProps) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';

  if (isLandingPage) {
    return (
      <div className="min-h-screen bg-[#f8f8f9] text-on-surface">
        <Suspense fallback={null}>
          <ClientNavigationTiming />
        </Suspense>
        <Suspense fallback={null}>
          <LandingHeader
            editions={editions}
            analyticsEnabled={analyticsEnabled}
            askCentrePassEnabled={askCentrePassEnabled}
          />
        </Suspense>
        <main className="pb-24 xl:pb-0">
          {children}
        </main>
        <Suspense fallback={null}>
          <BottomNav
            editions={editions}
            analyticsEnabled={analyticsEnabled}
            askCentrePassEnabled={askCentrePassEnabled}
            hideAt="xl"
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Suspense fallback={null}>
        <ClientNavigationTiming />
      </Suspense>
      <Suspense fallback={null}>
        <Sidebar
          editions={editions}
          analyticsEnabled={analyticsEnabled}
          askCentrePassEnabled={askCentrePassEnabled}
        />
      </Suspense>
      <main className="lg:ml-[264px] pt-4 pb-24 lg:pb-8 px-4 md:px-8">
        {editions.length > 0 && (
          <div className="mx-auto mb-4 max-w-7xl rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4 lg:hidden">
            <Suspense fallback={null}>
              <GlobalEditionSelector editions={editions} surface="mobile" />
            </Suspense>
          </div>
        )}
        {children}
      </main>
      <Suspense fallback={null}>
        <BottomNav
          editions={editions}
          analyticsEnabled={analyticsEnabled}
          askCentrePassEnabled={askCentrePassEnabled}
        />
      </Suspense>
    </div>
  );
}
