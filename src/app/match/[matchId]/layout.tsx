import { notFound } from 'next/navigation';
import { resolvePublicMatchForRequest } from '@/lib/public-match';

export default async function PublicMatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  const match = await resolvePublicMatchForRequest(matchId);

  if (!match) notFound();
  return children;
}
