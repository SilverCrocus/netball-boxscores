import type { EditionContextValue } from '@/lib/edition-context';

export type EditionDestination = '' | 'standings' | 'teams' | 'pools' | 'bracket';
export type MatchDestination = '' | 'live' | 'court';

const EDITION_ROUTE_PATTERN =
  /^\/competitions\/([^/]+)\/([^/]+)(?:\/(standings|teams|pools|bracket))?\/?$/;

const EDITION_AWARE_LEGACY_DESTINATIONS: Record<string, EditionDestination> = {
  '/': '',
  '/standings': 'standings',
  '/teams': 'teams',
};

export function editionBasePath(context: EditionContextValue): string {
  const path = `/competitions/${encodeURIComponent(context.competitionSlug)}/${encodeURIComponent(context.editionSlug)}`;
  return context.navigationOrigin
    ? new URL(path, context.navigationOrigin).toString()
    : path;
}

export function editionHref(
  context: EditionContextValue,
  destination: EditionDestination = ''
): string {
  const base = editionBasePath(context);
  return destination ? `${base}/${destination}` : base;
}

/**
 * Scope a legacy detail URL to a canonical competition edition. The edition
 * remains optional so older callers and historical links continue to work.
 */
export function editionScopedHref(
  href: string,
  editionId?: string | null,
): string {
  if (!editionId) return href;
  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}edition=${encodeURIComponent(editionId)}`;
}

/** Build the canonical public URL for a match inside its real edition. */
export function matchHref(
  matchId: string,
  editionId: string,
  destination: MatchDestination = '',
): string {
  const base = `/match/${encodeURIComponent(matchId)}`;
  const path = destination ? `${base}/${destination}` : base;
  return editionScopedHref(path, editionId);
}

/** A match URL is canonical only when its query identifies the owning edition. */
export function isCanonicalMatchEdition(
  requestedEditionId: string | null | undefined,
  actualEditionId: string,
): boolean {
  return requestedEditionId === actualEditionId;
}

/** All navigation surfaces share this helper so route context cannot drift. */
export function editionNavigationHref(
  context: EditionContextValue,
  destination: EditionDestination
): string {
  return editionHref(context, destination);
}

export function editionSwitchHref(
  target: EditionContextValue,
  currentPathname: string
): string {
  const editionMatch = currentPathname.match(EDITION_ROUTE_PATTERN);
  const legacyDestination = EDITION_AWARE_LEGACY_DESTINATIONS[currentPathname];
  const destination = (editionMatch?.[3] ?? legacyDestination ?? '') as EditionDestination;
  return editionHref(target, destination);
}

export function editionContextFromPathname(
  editions: EditionContextValue[],
  pathname: string
): EditionContextValue | null {
  const match = pathname.match(EDITION_ROUTE_PATTERN);
  if (!match) return null;

  const competitionSlug = decodeURIComponent(match[1]);
  const editionSlug = decodeURIComponent(match[2]);

  return editions.find((edition) =>
    edition.competitionSlug === competitionSlug
      && edition.editionSlug === editionSlug
  ) ?? null;
}

export function isEditionRoutePathname(pathname: string): boolean {
  return pathname === '/competitions' || pathname.startsWith('/competitions/');
}

/**
 * Legacy pages keep the first public edition selected. Edition routes resolve
 * exactly, so an unknown slug never silently selects another tournament.
 */
export function navigationEditionFromPathname(
  editions: EditionContextValue[],
  pathname: string
): EditionContextValue | null {
  return navigationEditionFromLocation(editions, pathname);
}

/** Preserve edition context on legacy detail pages that carry a canonical edition id. */
export function navigationEditionFromLocation(
  editions: EditionContextValue[],
  pathname: string,
  editionId?: string | null,
): EditionContextValue | null {
  const exactEdition = editionContextFromPathname(editions, pathname);
  if (exactEdition || isEditionRoutePathname(pathname)) return exactEdition;
  if (editionId) {
    return editions.find((edition) => edition.id === editionId) ?? null;
  }
  return editions[0] ?? null;
}

export function editionAwareNavigationHref(
  edition: EditionContextValue | null,
  legacyHref: string
): string {
  const destination = EDITION_AWARE_LEGACY_DESTINATIONS[legacyHref];
  return edition && destination !== undefined
    ? editionNavigationHref(edition, destination)
    : legacyHref;
}
