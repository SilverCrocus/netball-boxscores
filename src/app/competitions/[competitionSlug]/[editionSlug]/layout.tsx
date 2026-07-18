import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditionContextProvider } from '@/components/competition/EditionContext';
import { resolveEdition } from '@/lib/competitions';
import { toEditionContext, toEditionContexts } from '@/lib/edition-context';

interface EditionLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    competitionSlug: string;
    editionSlug: string;
  }>;
}

export async function generateMetadata({ params }: EditionLayoutProps): Promise<Metadata> {
  const identity = await params;
  const { edition } = await resolveEdition(identity);

  if (!edition) return {};

  return {
    title: `${edition.series?.name ?? edition.name} ${edition.label ?? edition.season}`,
    description: `Scores, fixtures, standings, teams, and statistics for ${edition.series?.name ?? edition.name} ${edition.label ?? edition.season}.`,
  };
}

export default async function EditionLayout({ children, params }: EditionLayoutProps) {
  const identity = await params;
  const { edition, editions } = await resolveEdition(identity);

  if (!edition) notFound();

  const current = toEditionContext(edition);
  const options = toEditionContexts(editions);

  return (
    <EditionContextProvider value={{ current, editions: options }}>
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 rounded-2xl border border-outline-variant bg-surface-container-low p-4 md:p-6">
          <div>
            <p className="font-label text-xs font-bold uppercase tracking-[0.18em] text-secondary">
              {current.competitionName}
            </p>
            <h1 className="mt-1 font-headline text-2xl font-bold text-on-surface md:text-3xl">
              {current.editionLabel}
            </h1>
          </div>
        </header>
        {children}
      </div>
    </EditionContextProvider>
  );
}
