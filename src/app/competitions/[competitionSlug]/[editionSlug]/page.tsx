import { notFound } from 'next/navigation';
import { EditionHero } from '@/components/competition/EditionHero';
import { EditionSchedule } from '@/components/competition/EditionSchedule';
import { resolveEdition } from '@/lib/competitions';
import { getEditionSchedule } from '@/lib/edition-schedule';

export const dynamic = 'force-dynamic';

interface EditionPageProps {
  params: Promise<{
    competitionSlug: string;
    editionSlug: string;
  }>;
}

export default async function EditionPage({ params }: EditionPageProps) {
  const identity = await params;
  const { edition } = await resolveEdition(identity);

  if (!edition) notFound();

  const schedule = await getEditionSchedule(edition);

  return (
    <div>
      <EditionHero schedule={schedule} />
      <EditionSchedule schedule={schedule} />
    </div>
  );
}
