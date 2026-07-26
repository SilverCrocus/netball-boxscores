import { unstable_cache } from 'next/cache';
import {
  fetchOfficialObservationsForDate,
  londonMatchTimePrefix,
  type OfficialFeedObservation,
} from '@/lib/glasgow/official-feed';
import { canonicalGlasgowTeamCode } from '@/lib/glasgow/team-codes';

export const GLASGOW_2026_DETAILED_RESULTS_ORIGIN =
  'https://crs-cg2026.glasgow2026.com';

const OFFICIAL_ROUTE_TOKEN = /^[A-Z0-9-]+$/;
const OFFICIAL_RESULTS_TIMEOUT_MS = 4_000;

type ObservationFetcher = (
  localDate: string,
) => Promise<readonly OfficialFeedObservation[]>;

interface OfficialLiveCentreInput {
  scheduledAt: Date;
  homeTeamAbbreviation: string;
  awayTeamAbbreviation: string;
}

interface OfficialLiveCentreDependencies {
  fetchObservations?: ObservationFetcher;
}

const fetchCachedOfficialObservations = unstable_cache(
  (localDate: string) => fetchOfficialObservationsForDate(localDate, {
    timeoutMs: OFFICIAL_RESULTS_TIMEOUT_MS,
  }),
  ['glasgow-2026-detailed-results-observations-v1'],
  { revalidate: 15 },
);

function isOfficialRouteToken(value: string): boolean {
  return value.length > 0
    && value.length <= 32
    && OFFICIAL_ROUTE_TOKEN.test(value);
}

/**
 * Builds a deep link without trusting a provider-owned URL. Every route
 * segment is verified against the typed observation before it is placed on
 * the fixed Glasgow 2026 detailed-results origin.
 */
export function officialDetailedResultsUrl(
  observation: OfficialFeedObservation,
): string | null {
  const prefix = observation.providerDisciplineCode
    + observation.providerGenderCode
    + observation.providerEventCode
    + observation.providerPhaseCode;
  if (!observation.providerMatchCode.startsWith(prefix)) return null;

  const eventUnitCode = observation.providerMatchCode.slice(prefix.length);
  const routeSegments = [
    observation.providerDisciplineCode,
    observation.providerGenderCode,
    observation.providerEventCode,
    observation.providerPhaseCode,
    eventUnitCode,
  ];
  if (routeSegments.some((segment) => !isOfficialRouteToken(segment))) {
    return null;
  }

  return `${GLASGOW_2026_DETAILED_RESULTS_ORIGIN}/#/team-players/`
    + routeSegments.map(encodeURIComponent).join('/');
}

export async function resolveOfficialGlasgowLiveCentreUrl(
  input: OfficialLiveCentreInput,
  dependencies: OfficialLiveCentreDependencies = {},
): Promise<string | null> {
  if (
    Number.isNaN(input.scheduledAt.getTime())
    || !isOfficialRouteToken(input.homeTeamAbbreviation)
    || !isOfficialRouteToken(input.awayTeamAbbreviation)
  ) {
    return null;
  }

  const matchTimePrefix = londonMatchTimePrefix(input.scheduledAt.toISOString());
  const localDate = matchTimePrefix.slice(0, 10);
  const fetchObservations = dependencies.fetchObservations
    ?? fetchCachedOfficialObservations;

  let observations: readonly OfficialFeedObservation[];
  try {
    observations = await fetchObservations(localDate);
  } catch {
    return null;
  }

  const candidates = observations.filter((observation) => (
    londonMatchTimePrefix(observation.startDate) === matchTimePrefix
    && canonicalGlasgowTeamCode(observation.sideAOrganisationCode)
      === canonicalGlasgowTeamCode(input.homeTeamAbbreviation)
    && canonicalGlasgowTeamCode(observation.sideBOrganisationCode)
      === canonicalGlasgowTeamCode(input.awayTeamAbbreviation)
  ));
  if (candidates.length !== 1) return null;

  return officialDetailedResultsUrl(candidates[0]);
}
