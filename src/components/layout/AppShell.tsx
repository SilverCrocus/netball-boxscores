import { Suspense } from 'react';
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { ClientNavigationTiming } from './ClientNavigationTiming';
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
