import type { EditionContextValue } from '@/lib/edition-context';

export type EditionDestination = '' | 'standings' | 'teams' | 'pools' | 'bracket';

export function editionBasePath(context: EditionContextValue): string {
  return `/competitions/${encodeURIComponent(context.competitionSlug)}/${encodeURIComponent(context.editionSlug)}`;
}

export function editionHref(
  context: EditionContextValue,
  destination: EditionDestination = ''
): string {
  const base = editionBasePath(context);
  return destination ? `${base}/${destination}` : base;
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
  const match = currentPathname.match(
    /^\/competitions\/[^/]+\/[^/]+(?:\/(standings|teams|pools|bracket))?\/?$/
  );
  const destination = (match?.[1] ?? '') as EditionDestination;
  return editionHref(target, destination);
}
