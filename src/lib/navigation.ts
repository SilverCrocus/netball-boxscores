interface NavItem {
  href: string;
  label: string;
  icon: string;
  sidebarLabel?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Fixtures', icon: 'calendar_today', sidebarLabel: 'Home' },
  { href: '/?filter=live', label: 'Live', icon: 'sensors' },
  { href: '/standings', label: 'Standings', icon: 'leaderboard' },
  { href: '/teams', label: 'Teams', icon: 'groups' },
];
