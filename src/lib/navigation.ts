interface NavItem {
  href: string;
  label: string;
  icon: string;
  sidebarLabel?: string;
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(href));
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Fixtures', icon: 'calendar_today', sidebarLabel: 'Home' },
  { href: '/live', label: 'Live', icon: 'sensors' },
  { href: '/standings', label: 'Standings', icon: 'leaderboard' },
  { href: '/teams', label: 'Teams', icon: 'groups' },
];
