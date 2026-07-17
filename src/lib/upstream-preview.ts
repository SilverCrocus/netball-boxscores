import type { CompletedMatchesPage, HomeResultCard } from '@/lib/home-feed';
import { matchHref } from '@/lib/edition-links';

const DEFAULT_UPSTREAM_ORIGIN = 'https://www.centrepass.io';
const UPSTREAM_TIMEOUT_MS = 5_000;

export interface PreviewLiveStatus {
  hasLive: boolean;
  nextMatchAt: string | null;
}

export function isUpstreamPreviewMode(): boolean {
  return process.env.NODE_ENV !== 'production'
    && process.env.CENTREPASS_PREVIEW_DATA_MODE === 'upstream';
}

function upstreamOrigin(): string | null {
  if (!isUpstreamPreviewMode()) return null;

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

async function fetchUpstreamJson(path: string): Promise<unknown | null> {
  const origin = upstreamOrigin();
  if (!origin) return null;

  try {
    const response = await fetch(`${origin}${path}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json() as unknown;
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
  const origin = upstreamOrigin();
  if (!origin) return null;

  const query = params.toString();
  const payload = record(await fetchUpstreamJson(`/api/matches${query ? `?${query}` : ''}`));
  if (!payload || !Array.isArray(payload.groups)) return null;

  const groups = payload.groups.flatMap((value) => {
    const group = record(value);
    if (!group || typeof group.label !== 'string' || !Array.isArray(group.matches)) return [];

    const matches = group.matches.flatMap((match) => {
      const normalized = completedMatch(match, origin);
      return normalized ? [normalized] : [];
    });

    return matches.length > 0 ? [{ label: group.label, matches }] : [];
  });

  return {
    groups,
    nextCursor: optionalString(payload.nextCursor),
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
