import { OfficialLiveCentre } from '@/components/match/OfficialLiveCentre';
import {
  resolveOfficialGlasgowLiveCentreUrl,
} from '@/lib/glasgow/official-results-link';

interface OfficialLiveCentreResolverProps {
  scheduledAt: Date;
  homeTeamAbbreviation: string;
  awayTeamAbbreviation: string;
  isLive: boolean;
}

export async function OfficialLiveCentreResolver({
  scheduledAt,
  homeTeamAbbreviation,
  awayTeamAbbreviation,
  isLive,
}: OfficialLiveCentreResolverProps) {
  const src = await resolveOfficialGlasgowLiveCentreUrl({
    scheduledAt,
    homeTeamAbbreviation,
    awayTeamAbbreviation,
  });

  return src === null ? null : <OfficialLiveCentre src={src} isLive={isLive} />;
}
