import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';
import { GlobalEditionSelector } from '@/components/competition/GlobalEditionSelector';
import type { EditionContextValue } from '@/lib/edition-context';

interface AppShellProps {
  children: React.ReactNode;
  editions?: EditionContextValue[];
}

export function AppShell({ children, editions = [] }: AppShellProps) {
  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Sidebar editions={editions} />
      <main className="lg:ml-[264px] pt-4 pb-24 lg:pb-8 px-4 md:px-8">
        {editions.length > 0 && (
          <div className="mx-auto mb-4 max-w-7xl rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4 lg:hidden">
            <GlobalEditionSelector editions={editions} surface="mobile" />
          </div>
        )}
        {children}
      </main>
      <BottomNav editions={editions} />
    </div>
  );
}
