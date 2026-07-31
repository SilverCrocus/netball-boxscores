import glasgowBundle from '../../data/glasgow-2026/v1/bundle.json';
import type { CompletedMatchesPage, HomeResultCard } from '@/lib/home-feed';
import { matchHref } from '@/lib/edition-links';
import { fetchJsonWithinLimits } from '@/lib/bounded-fetch';
import {
  GLASGOW_2026_IDENTITY,
  isGlasgow2026Identity,
} from '@/lib/edition-publication-readiness';

const DEFAULT_UPSTREAM_ORIGIN = 'https://www.centrepass.io';
const UPSTREAM_TIMEOUT_MS = 5_000;
const UPSTREAM_MAX_BYTES = 2 * 1024 * 1024;
const GLASGOW_TEAM_NAMES = new Set(
  glasgowBundle.teams.map((team) => team.name.trim().toLocaleLowerCase()),
);

export interface PreviewLiveStatus {
  hasLive: boolean;
  nextMatchAt: string | null;
}

export function isUpstreamPreviewMode(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.CENTREPASS_PREVIEW_DATA_MODE === 'upstream';
}

export function glasgowUpstreamResultsParams(): URLSearchParams {
  return new URLSearchParams([
    ['competitionSlug', GLASGOW_2026_IDENTITY.competitionSlug],
    ['editionSlug', GLASGOW_2026_IDENTITY.editionSlug],
  ]);
}

/** Normalize the configured hosted origin shared by preview data and links. */
export function upstreamPreviewOrigin(): string | null {
  const configured = process.env.CENTREPASS_UPSTREAM_ORIGIN?.trim()
    || DEFAULT_UPSTREAM_ORIGIN;

  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function activeUpstreamOrigin(): string | null {
  return isUpstreamPreviewMode() ? upstreamPreviewOrigin() : null;
}

async function fetchUpstreamJson(path: string): Promise<unknown | null> {
  const origin = activeUpstreamOrigin();
  if (!origin) return null;

  try {
    return await fetchJsonWithinLimits<unknown>({
      url: `${origin}${path}`,
      label: 'Preview upstream',
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      maxBytes: UPSTREAM_MAX_BYTES,
      init: { cache: 'no-store' },
    });
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function scoreBreakdown(value: unknown): { goals: number; superShots: number } | null {
  const item = record(value);
  return item && typeof item.goals === 'number' && typeof item.superShots === 'number'
    ? { goals: item.goals, superShots: item.superShots }
    : null;
}

function team(value: unknown): HomeResultCard['homeTeam'] | null {
  const item = record(value);
  if (!item || typeof item.name !== 'string' || typeof item.abbreviation !== 'string') return null;

  return {
    name: item.name,
    abbreviation: item.abbreviation,
    logoUrl: optionalString(item.logoUrl),
  };
}

function isGlasgowTeamName(value: string): boolean {
  return GLASGOW_TEAM_NAMES.has(value.trim().toLocaleLowerCase());
}

function isGlasgowResult(match: HomeResultCard): boolean {
  return isGlasgowTeamName(match.homeTeam.name)
    && isGlasgowTeamName(match.awayTeam.name);
}

function completedMatch(value: unknown, origin: string): HomeResultCard | null {
  const item = record(value);
  const homeTeam = team(item?.homeTeam);
  const awayTeam = team(item?.awayTeam);
  const scheduledAt = optionalString(item?.scheduledAt);
  const competitionId = optionalString(item?.competitionId);

  if (
    !item
    || typeof item.id !== 'string'
    || item.status !== 'COMPLETED'
    || item.scoreAvailable !== true
    || !scheduledAt
    || Number.isNaN(new Date(scheduledAt).getTime())
    || typeof item.homeScore !== 'number'
    || typeof item.awayScore !== 'number'
    || typeof item.venue !== 'string'
    || !homeTeam
    || !awayTeam
  ) {
    return null;
  }

  return {
    id: item.id,
    ...(competitionId ? { competitionId } : {}),
    href: competitionId
      ? `${origin}${matchHref(item.id, competitionId)}`
      : `${origin}/match/${encodeURIComponent(item.id)}`,
    status: 'COMPLETED',
    scoreAvailable: true,
    scheduledAt,
    homeScore: item.homeScore,
    awayScore: item.awayScore,
    venue: item.venue,
    round: typeof item.round === 'number' ? item.round : null,
    roundLabel: optionalString(item.roundLabel),
    stageName: optionalString(item.stageName),
    finalCode: optionalString(item.finalCode),
    homeTeam,
    awayTeam,
    homeBreakdown: scoreBreakdown(item.homeBreakdown),
    awayBreakdown: scoreBreakdown(item.awayBreakdown),
  };
}

export async function loadUpstreamCompletedMatches(
  params = new URLSearchParams(),
): Promise<CompletedMatchesPage | null> {
  const origin = activeUpstreamOrigin();
  if (!origin) return null;

  const query = params.toString();
  const payload = record(await fetchUpstreamJson(`/api/matches${query ? `?${query}` : ''}`));
  if (!payload || !Array.isArray(payload.groups)) return null;
  const requireGlasgowTeams = isGlasgow2026Identity({
    competitionSlug: params.get('competitionSlug'),
    editionSlug: params.get('editionSlug'),
  });

  const groups = payload.groups.flatMap((value) => {
    const group = record(value);
    if (!group || typeof group.label !== 'string' || !Array.isArray(group.matches)) return [];

    const matches = group.matches.flatMap((match) => {
      const normalized = completedMatch(match, origin);
      return normalized && (!requireGlasgowTeams || isGlasgowResult(normalized))
        ? [normalized]
        : [];
    });

    return matches.length > 0 ? [{ label: group.label, matches }] : [];
  });

  return {
    groups,
    // A cursor from a mismatched hosted edition must not make the filtered
    // Glasgow preview look non-empty. Keep pagination only once at least one
    // governed Glasgow result has survived validation.
    nextCursor: requireGlasgowTeams && groups.length === 0
      ? null
      : optionalString(payload.nextCursor),
  };
}

export async function loadUpstreamLiveStatus(): Promise<PreviewLiveStatus | null> {
  const payload = record(await fetchUpstreamJson('/api/live-status'));
  if (!payload || typeof payload.hasLive !== 'boolean') return null;

  return {
    hasLive: payload.hasLive,
    nextMatchAt: optionalString(payload.nextMatchAt),
  };
}
