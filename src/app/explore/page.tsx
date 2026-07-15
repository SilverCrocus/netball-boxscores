import type { Metadata } from 'next';
import { ExploreClient } from '@/app/explore/ExploreClient';

export const metadata: Metadata = {
  title: 'Explore Netball Statistics',
  description: 'Ask CentrePass a netball statistics question and inspect the exact metric, sample, coverage, matches, and formula behind the answer.',
};

interface ExplorePageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const query = await searchParams;
  const initialQuestion = typeof query.q === 'string' ? query.q.slice(0, 300).replace(/\s+/g, ' ').trim() : '';
  return <ExploreClient initialQuestion={initialQuestion} />;
}
