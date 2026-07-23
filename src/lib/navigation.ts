export interface NavItem {
  href: string;
  label: string;
  icon: string;
  sidebarLabel?: string;
}

export type NavigationPrefetchPolicy = 'off' | 'intent-full';

const INTENT_FULL_PREFETCH_HREFS = new Set(['/rankings', '/records']);
const OFF_PREFETCH_HREFS = new Set(['/teams', '/compare/players', '/explore']);

/**
 * Only the two analytics entry points opt into a full prefetch after explicit
 * user intent. Low-value destinations opt out of viewport prefetch explicitly;
 * every other destination keeps Next's ordinary default behavior.
 */
export function getNavigationPrefetchPolicy(href: string): NavigationPrefetchPolicy | undefined {
  if (INTENT_FULL_PREFETCH_HREFS.has(href)) return 'intent-full';
  if (OFF_PREFETCH_HREFS.has(href)) return 'off';
  return undefined;
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(href));
}

/**
 * Edition landing links behave like the root home link: they are exact-only.
 * Other resolved section links may remain active for their nested routes.
 */
export function isResolvedNavigationActive(
  pathname: string,
  legacyHref: string,
  resolvedHref: string,
): boolean {
  const resolvedActive = legacyHref === '/' && resolvedHref !== '/'
    ? pathname === resolvedHref
    : isActive(pathname, resolvedHref);

  return isActive(pathname, legacyHref) || resolvedActive;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Fixtures', icon: 'calendar_today', sidebarLabel: 'Home' },
  { href: '/live', label: 'Live', icon: 'sensors' },
  { href: '/standings', label: 'Standings', icon: 'leaderboard' },
  { href: '/rankings', label: 'Rankings', icon: 'workspace_premium' },
  { href: '/records', label: 'Records', icon: 'trophy' },
  { href: '/compare/players', label: 'Compare', icon: 'compare_arrows' },
  { href: '/explore', label: 'Ask', icon: 'query_stats', sidebarLabel: 'Ask CentrePass' },
  { href: '/teams', label: 'Teams', icon: 'groups' },
];

const ANALYTICS_HREFS = new Set(['/rankings', '/records', '/compare/players']);

export function getVisibleNavigationItems(input: {
  analyticsEnabled: boolean;
  askCentrePassEnabled: boolean;
}): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.href === '/explore') return input.askCentrePassEnabled;
    if (ANALYTICS_HREFS.has(item.href)) return input.analyticsEnabled;
    return true;
  });
}
