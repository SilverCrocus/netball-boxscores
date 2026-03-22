# NETPULSE UI Implementation Plan (Tasks 5-11)

## Design System Reference

All components use the shared MD3 token system from Stitch prototypes:
- **Colors**: `primary: #000613`, `primary-container: #001f3f`, `secondary: #006e0a`, `secondary-container: #69fd5d`, `surface: #faf9fc`
- **Fonts**: `font-headline` (Lexend), `font-body` (Manrope), `font-label` (Inter)
- **Patterns**: `kinetic-gradient` (135deg #000613 to #001f3f), `pulse-live` animation, bento grid cards

---

### Task 5: Design System & AppShell

**Files:**
- Create `src/components/layout/AppShell.tsx`
- Create `src/components/layout/Sidebar.tsx`
- Create `src/components/layout/BottomNav.tsx`
- Modify `src/app/layout.tsx`
- Create `src/components/layout/__tests__/AppShell.test.tsx`
- Create `src/components/layout/__tests__/Sidebar.test.tsx`
- Create `src/components/layout/__tests__/BottomNav.test.tsx`

- [ ] **Step 1: Write AppShell test**

Create `src/components/layout/__tests__/AppShell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppShell } from '../AppShell';

describe('AppShell', () => {
  it('renders children content', () => {
    render(<AppShell><div data-testid="child">Content</div></AppShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders sidebar on desktop', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('renders bottom nav', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders NETPULSE branding', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByText('NETPULSE')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run AppShell test (expect fail)**

```bash
npx vitest run src/components/layout/__tests__/AppShell.test.tsx
```

- [ ] **Step 3: Implement Sidebar component**

Create `src/components/layout/Sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/?filter=live', label: 'Live', icon: 'sensors' },
  { href: '/standings', label: 'Standings', icon: 'leaderboard' },
  { href: '/teams', label: 'Teams', icon: 'groups' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col h-full w-[264px] fixed left-0 top-0 bg-slate-900 py-8 z-40 shadow-xl">
      <div className="px-6 mb-8">
        <span className="text-2xl font-black italic tracking-tighter text-white uppercase font-headline">
          NETPULSE
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 py-3 pl-4 border-l-4 transition-all font-headline font-medium text-sm ${
                isActive
                  ? 'text-lime-400 border-lime-400 bg-slate-800/30'
                  : 'text-slate-400 border-transparent hover:bg-slate-800'
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 4: Implement BottomNav component**

Create `src/components/layout/BottomNav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Fixtures', icon: 'calendar_today' },
  { href: '/?filter=live', label: 'Live', icon: 'sensors' },
  { href: '/standings', label: 'Standings', icon: 'leaderboard' },
  { href: '/teams', label: 'Teams', icon: 'groups' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pb-6 pt-2 bg-slate-950 rounded-t-2xl shadow-[0_-8px_24px_rgba(0,0,0,0.6)] border-t border-slate-800/50">
      {navItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center py-1 px-4 rounded-xl transition-all ${
              isActive
                ? 'bg-lime-500 text-slate-950 scale-105'
                : 'text-slate-500 hover:bg-slate-800'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            <span className="font-bold font-headline text-[10px] tracking-tight uppercase">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Implement AppShell component**

Create `src/components/layout/AppShell.tsx`:

```tsx
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Sidebar />
      <main className="lg:ml-[264px] pt-4 pb-24 lg:pb-8 px-4 md:px-8">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 6: Update root layout**

Modify `src/app/layout.tsx` to wrap children with AppShell:

```tsx
import type { Metadata } from 'next';
import { Lexend, Manrope, Inter } from 'next/font/google';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

const lexend = Lexend({
  subsets: ['latin'],
  variable: '--font-headline',
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-label',
});

export const metadata: Metadata = {
  title: 'NETPULSE - Suncorp Super Netball',
  description: 'Live scores, stats, and fixtures for Suncorp Super Netball',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${lexend.variable} ${manrope.variable} ${inter.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Run AppShell tests (expect pass)**

```bash
npx vitest run src/components/layout/__tests__/AppShell.test.tsx
```

- [ ] **Step 8: Commit Task 5**

```bash
git add src/components/layout/ src/app/layout.tsx
git commit -m "feat: add AppShell with responsive sidebar and bottom nav"
```

---

### Task 6: Shared Components

**Files:**
- Create `src/components/ui/ScoreCard.tsx`
- Create `src/components/ui/PlayerStatsTable.tsx`
- Create `src/components/ui/LiveIndicator.tsx`
- Create `src/components/ui/QuarterScoreBar.tsx`
- Create `src/components/ui/TeamBadge.tsx`
- Create `src/components/ui/StatCard.tsx`
- Create `src/components/ui/MatchMomentum.tsx`
- Create `src/components/ui/__tests__/ScoreCard.test.tsx`
- Create `src/components/ui/__tests__/PlayerStatsTable.test.tsx`
- Create `src/components/ui/__tests__/LiveIndicator.test.tsx`
- Create `src/components/ui/__tests__/QuarterScoreBar.test.tsx`
- Create `src/components/ui/__tests__/TeamBadge.test.tsx`
- Create `src/components/ui/__tests__/StatCard.test.tsx`
- Create `src/components/ui/__tests__/MatchMomentum.test.tsx`

- [ ] **Step 1: Write LiveIndicator test**

Create `src/components/ui/__tests__/LiveIndicator.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LiveIndicator } from '../LiveIndicator';

describe('LiveIndicator', () => {
  it('renders LIVE text', () => {
    render(<LiveIndicator />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders pulsing dot', () => {
    const { container } = render(<LiveIndicator />);
    expect(container.querySelector('.animate-ping')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<LiveIndicator className="ml-2" />);
    expect(container.firstChild).toHaveClass('ml-2');
  });
});
```

- [ ] **Step 2: Implement LiveIndicator**

Create `src/components/ui/LiveIndicator.tsx`:

```tsx
interface LiveIndicatorProps {
  className?: string;
}

export function LiveIndicator({ className = '' }: LiveIndicatorProps) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
      </span>
      <span className="font-label text-[10px] font-bold uppercase tracking-tighter text-secondary">
        LIVE
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Run LiveIndicator test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/LiveIndicator.test.tsx
```

- [ ] **Step 4: Write TeamBadge test**

Create `src/components/ui/__tests__/TeamBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TeamBadge } from '../TeamBadge';

describe('TeamBadge', () => {
  it('renders team name', () => {
    render(<TeamBadge name="Melbourne Vixens" abbreviation="VIX" />);
    expect(screen.getByText('Melbourne Vixens')).toBeInTheDocument();
  });

  it('renders logo when provided', () => {
    render(<TeamBadge name="Vixens" abbreviation="VIX" logoUrl="/vixens.png" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/vixens.png');
  });

  it('renders abbreviation fallback when no logo', () => {
    render(<TeamBadge name="Vixens" abbreviation="VIX" />);
    expect(screen.getByText('VIX')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement TeamBadge**

Create `src/components/ui/TeamBadge.tsx`:

```tsx
import Image from 'next/image';

interface TeamBadgeProps {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: { badge: 'w-8 h-8', text: 'text-xs', name: 'text-xs' },
  md: { badge: 'w-12 h-12', text: 'text-lg', name: 'text-sm' },
  lg: { badge: 'w-16 h-16', text: 'text-xl', name: 'text-base' },
};

export function TeamBadge({ name, abbreviation, logoUrl, size = 'md' }: TeamBadgeProps) {
  const s = sizeClasses[size];

  return (
    <div className="flex items-center gap-3">
      <div className={`${s.badge} rounded-lg bg-primary-container flex items-center justify-center overflow-hidden`}>
        {logoUrl ? (
          <Image src={logoUrl} alt={name} width={48} height={48} className="w-full h-full object-contain" />
        ) : (
          <span className={`${s.text} font-black italic text-white font-headline`}>
            {abbreviation.charAt(0)}
          </span>
        )}
      </div>
      <span className={`${s.name} font-bold font-headline text-primary uppercase`}>{name}</span>
    </div>
  );
}
```

- [ ] **Step 6: Run TeamBadge test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/TeamBadge.test.tsx
```

- [ ] **Step 7: Write ScoreCard test**

Create `src/components/ui/__tests__/ScoreCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ScoreCard } from '../ScoreCard';

const liveMatch = {
  id: '1',
  homeTeam: { name: 'Vixens', abbreviation: 'VIX', logoUrl: null },
  awayTeam: { name: 'Firebirds', abbreviation: 'FIR', logoUrl: null },
  homeScore: 42,
  awayScore: 38,
  status: 'LIVE' as const,
  currentQuarter: 3,
  currentTime: '04:12',
  round: 12,
  venue: 'Arena',
};

const scheduledMatch = {
  ...liveMatch,
  id: '2',
  homeScore: 0,
  awayScore: 0,
  status: 'SCHEDULED' as const,
  currentQuarter: null,
  currentTime: null,
  scheduledAt: '2026-03-25T09:30:00Z',
};

describe('ScoreCard', () => {
  it('renders both team names', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('Vixens')).toBeInTheDocument();
    expect(screen.getByText('Firebirds')).toBeInTheDocument();
  });

  it('renders scores', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
  });

  it('shows LIVE indicator for live matches', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('shows quarter info for live matches', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText(/Q3/)).toBeInTheDocument();
  });

  it('does not show LIVE indicator for scheduled matches', () => {
    render(<ScoreCard match={scheduledMatch} />);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Implement ScoreCard**

Create `src/components/ui/ScoreCard.tsx`:

Reference: `fixtures-scores-hub/index.html` live card pattern. White card with `border-l-4 border-secondary` for live, rounded-xl, shadow-sm.

```tsx
import Link from 'next/link';
import { LiveIndicator } from './LiveIndicator';

interface TeamInfo {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
}

interface ScoreCardMatch {
  id: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number;
  awayScore: number;
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETED';
  currentQuarter?: number | null;
  currentTime?: string | null;
  round?: number;
  venue?: string;
  scheduledAt?: string;
}

interface ScoreCardProps {
  match: ScoreCardMatch;
}

export function ScoreCard({ match }: ScoreCardProps) {
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';

  return (
    <Link
      href={`/match/${match.id}`}
      className={`block bg-surface-container-lowest rounded-xl p-6 shadow-sm relative overflow-hidden group transition-all hover:shadow-md ${
        isLive ? 'border-l-4 border-secondary' : 'border-l-4 border-transparent'
      }`}
    >
      {/* Status badge */}
      <div className="flex justify-between items-start mb-6">
        {isLive && match.currentQuarter && (
          <span className="bg-primary-container text-on-primary-fixed-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Q{match.currentQuarter} {match.currentTime && `\u2022 ${match.currentTime}`}
          </span>
        )}
        {isCompleted && (
          <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Final
          </span>
        )}
        {match.status === 'SCHEDULED' && match.scheduledAt && (
          <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
            {new Date(match.scheduledAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {isLive && <LiveIndicator />}
      </div>

      {/* Score display */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col items-center flex-1 text-center">
          <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-white font-black italic text-lg font-headline mb-2">
            {match.homeTeam.abbreviation.charAt(0)}
          </div>
          <span className="text-sm font-bold font-headline text-primary uppercase">
            {match.homeTeam.name}
          </span>
        </div>

        <div className="flex items-center gap-4 text-4xl font-black font-headline text-primary tracking-tighter">
          <span>{match.homeScore}</span>
          <span className="text-outline-variant text-2xl">-</span>
          <span>{match.awayScore}</span>
        </div>

        <div className="flex flex-col items-center flex-1 text-center">
          <div className="w-12 h-12 bg-surface-container-high rounded-lg flex items-center justify-center text-primary font-black italic text-lg font-headline mb-2">
            {match.awayTeam.abbreviation.charAt(0)}
          </div>
          <span className="text-sm font-bold font-headline text-primary uppercase">
            {match.awayTeam.name}
          </span>
        </div>
      </div>

      {/* Footer */}
      {(match.round || match.venue) && (
        <div className="mt-6 pt-4 border-t border-surface-container flex justify-between items-center">
          <span className="text-[10px] font-medium text-on-surface-variant uppercase font-label">
            {match.round && `Round ${match.round}`} {match.venue && `\u2022 ${match.venue}`}
          </span>
          <span className="text-secondary font-bold text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
            View Stats
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </span>
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 9: Run ScoreCard test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/ScoreCard.test.tsx
```

- [ ] **Step 10: Write PlayerStatsTable test**

Create `src/components/ui/__tests__/PlayerStatsTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { PlayerStatsTable } from '../PlayerStatsTable';

const players = [
  {
    id: '1',
    name: 'Elena Rodriguez',
    position: 'GS' as const,
    photoUrl: null,
    goals: 42,
    attempts: 45,
    goalAssists: 0,
    intercepts: 0,
    deflections: 1,
    rebounds: 4,
    penalties: 0,
    feeds: 2,
    centrePassReceives: 0,
    turnovers: 1,
    minutesPlayed: 60,
  },
  {
    id: '2',
    name: 'Tasha Banks',
    position: 'GK' as const,
    photoUrl: null,
    goals: 0,
    attempts: 0,
    goalAssists: 0,
    intercepts: 8,
    deflections: 12,
    rebounds: 9,
    penalties: 2,
    feeds: 0,
    centrePassReceives: 0,
    turnovers: 0,
    minutesPlayed: 60,
  },
];

describe('PlayerStatsTable', () => {
  it('renders team name in header', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText(/THUNDER/i)).toBeInTheDocument();
  });

  it('renders all player names', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
    expect(screen.getByText('Tasha Banks')).toBeInTheDocument();
  });

  it('renders position badges', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('GS')).toBeInTheDocument();
    expect(screen.getByText('GK')).toBeInTheDocument();
  });

  it('renders goal stats', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Inter')).toBeInTheDocument();
    expect(screen.getByText('Reb')).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Implement PlayerStatsTable**

Create `src/components/ui/PlayerStatsTable.tsx`:

Reference: `box-score-player-stats/index.html` table. `kinetic-gradient` header, `surface-container-lowest` card, rows with hover state, position badges in `primary-container`.

```tsx
import type { Position } from '@prisma/client';

interface PlayerStat {
  id: string;
  name: string;
  position: Position;
  photoUrl?: string | null;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centrePassReceives: number;
  turnovers: number;
  minutesPlayed: number;
}

interface PlayerStatsTableProps {
  teamName: string;
  players: PlayerStat[];
}

export function PlayerStatsTable({ teamName, players }: PlayerStatsTableProps) {
  const shootingPct = (goals: number, attempts: number) =>
    attempts > 0 ? Math.round((goals / attempts) * 100) : null;

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
      <div className="bg-primary-container px-6 py-4 flex justify-between items-center">
        <h3 className="text-white font-headline font-bold text-lg tracking-tight uppercase">
          Player Performance - {teamName}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/20">
              <th className="px-6 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest">
                Player Name
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-center">
                Pos
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Goals
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Shots
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Shoot %
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Inter
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Deflect
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Reb
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {players.map((player) => {
              const pct = shootingPct(player.goals, player.attempts);
              return (
                <tr key={player.id} className="hover:bg-surface-container/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold font-headline text-primary-container text-sm">
                      {player.name}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="bg-primary-container text-white text-[10px] font-bold px-1.5 py-0.5 rounded font-label">
                      {player.position}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right font-black font-headline text-primary-container">
                    {player.goals}
                  </td>
                  <td className="px-4 py-4 text-right font-medium text-on-surface-variant">
                    {player.attempts}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {pct !== null ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-bold text-secondary">{pct}%</span>
                        <div className="w-12 bg-surface-container-high h-1 rounded-full overflow-hidden">
                          <div className="bg-secondary h-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="font-bold text-outline">-</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold">
                    {player.intercepts}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold text-on-surface-variant">
                    {player.deflections}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold text-secondary">
                    {player.rebounds}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Run PlayerStatsTable test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/PlayerStatsTable.test.tsx
```

- [ ] **Step 13: Write QuarterScoreBar test**

Create `src/components/ui/__tests__/QuarterScoreBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QuarterScoreBar } from '../QuarterScoreBar';

const quarters = [
  { quarter: 1, homeScore: 16, awayScore: 14 },
  { quarter: 2, homeScore: 12, awayScore: 18 },
  { quarter: 3, homeScore: 20, awayScore: 12 },
  { quarter: 4, homeScore: 16, awayScore: 14 },
];

describe('QuarterScoreBar', () => {
  it('renders all quarter labels', () => {
    render(<QuarterScoreBar quarters={quarters} />);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('Q4')).toBeInTheDocument();
  });

  it('renders correct number of bars', () => {
    const { container } = render(<QuarterScoreBar quarters={quarters} />);
    const bars = container.querySelectorAll('[data-testid^="quarter-bar-"]');
    expect(bars).toHaveLength(4);
  });
});
```

- [ ] **Step 14: Implement QuarterScoreBar**

Create `src/components/ui/QuarterScoreBar.tsx`:

Reference: `box-score-player-stats/index.html` match momentum bars. `primary-container` for home, `secondary/40` for away.

```tsx
interface Quarter {
  quarter: number;
  homeScore: number;
  awayScore: number;
}

interface QuarterScoreBarProps {
  quarters: Quarter[];
}

export function QuarterScoreBar({ quarters }: QuarterScoreBarProps) {
  return (
    <div className="space-y-4">
      {quarters.map((q) => {
        const total = q.homeScore + q.awayScore;
        const homePct = total > 0 ? (q.homeScore / total) * 100 : 50;
        const awayPct = total > 0 ? (q.awayScore / total) * 100 : 50;

        return (
          <div key={q.quarter} className="flex items-center gap-4" data-testid={`quarter-bar-${q.quarter}`}>
            <span className="text-[10px] font-bold font-label text-on-surface-variant w-8">
              Q{q.quarter}
            </span>
            <div className="flex-1 h-3 flex gap-1">
              <div
                className="bg-primary-container rounded-sm"
                style={{ width: `${homePct}%` }}
              />
              <div
                className="bg-secondary/40 rounded-sm"
                style={{ width: `${awayPct}%` }}
              />
            </div>
            <span className="text-[10px] font-bold font-label text-on-surface-variant w-12 text-right">
              {q.homeScore}-{q.awayScore}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 15: Write and implement StatCard**

Create `src/components/ui/__tests__/StatCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Goals" value="482" />);
    expect(screen.getByText('Total Goals')).toBeInTheDocument();
    expect(screen.getByText('482')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<StatCard label="Shooting" value="93%" subtitle="Season average" />);
    expect(screen.getByText('Season average')).toBeInTheDocument();
  });
});
```

Create `src/components/ui/StatCard.tsx`:

Reference: `box-score-player-stats/index.html` bento stat cards and `league-standings/index.html` featured stats.

```tsx
interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  variant?: 'default' | 'dark';
  icon?: string;
}

export function StatCard({ label, value, subtitle, variant = 'default', icon }: StatCardProps) {
  const isDark = variant === 'dark';

  return (
    <div
      className={`rounded-xl p-6 relative overflow-hidden ${
        isDark
          ? 'bg-primary-container text-white'
          : 'bg-surface-container-low'
      }`}
    >
      {icon && (
        <div className="absolute -right-8 -bottom-8 opacity-10">
          <span className="material-symbols-outlined text-[96px]">{icon}</span>
        </div>
      )}
      <h4
        className={`text-[10px] font-bold font-label uppercase tracking-widest mb-4 ${
          isDark ? 'text-lime-400' : 'text-on-surface-variant'
        }`}
      >
        {label}
      </h4>
      <div className="flex items-end gap-2">
        <span
          className={`text-5xl font-black font-headline ${
            isDark ? 'text-white' : 'text-primary-container'
          }`}
        >
          {value}
        </span>
      </div>
      {subtitle && (
        <p
          className={`text-sm mt-2 font-label ${
            isDark ? 'text-on-primary-container' : 'text-on-surface-variant'
          }`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 16: Write and implement MatchMomentum**

Create `src/components/ui/__tests__/MatchMomentum.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MatchMomentum } from '../MatchMomentum';

const scoreFlow = [
  { period: 1, homeScore: 1, awayScore: 0 },
  { period: 1, homeScore: 2, awayScore: 1 },
  { period: 1, homeScore: 3, awayScore: 2 },
];

describe('MatchMomentum', () => {
  it('renders heading', () => {
    render(<MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />);
    expect(screen.getByText('Match Momentum')).toBeInTheDocument();
  });

  it('renders SVG chart', () => {
    const { container } = render(
      <MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders team legend', () => {
    render(<MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />);
    expect(screen.getByText('Thunder')).toBeInTheDocument();
    expect(screen.getByText('Lightning')).toBeInTheDocument();
  });
});
```

Create `src/components/ui/MatchMomentum.tsx`:

Simple SVG line chart showing score flow over time. Two polylines (home/away) on an SVG canvas.

```tsx
interface ScoreFlowPoint {
  period: number;
  homeScore: number;
  awayScore: number;
}

interface MatchMomentumProps {
  scoreFlow: ScoreFlowPoint[];
  homeTeam: string;
  awayTeam: string;
}

export function MatchMomentum({ scoreFlow, homeTeam, awayTeam }: MatchMomentumProps) {
  if (scoreFlow.length === 0) return null;

  const width = 400;
  const height = 160;
  const padding = 20;

  const maxScore = Math.max(
    ...scoreFlow.map((p) => Math.max(p.homeScore, p.awayScore)),
    1
  );

  const toX = (i: number) =>
    padding + (i / Math.max(scoreFlow.length - 1, 1)) * (width - padding * 2);
  const toY = (score: number) =>
    height - padding - (score / maxScore) * (height - padding * 2);

  const homeLine = scoreFlow.map((p, i) => `${toX(i)},${toY(p.homeScore)}`).join(' ');
  const awayLine = scoreFlow.map((p, i) => `${toX(i)},${toY(p.awayScore)}`).join(' ');

  return (
    <div className="bg-surface-container-low rounded-xl p-6">
      <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-6">
        Match Momentum
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <polyline
          points={homeLine}
          fill="none"
          stroke="#001f3f"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={awayLine}
          fill="none"
          stroke="#006e0a"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="6 3"
        />
      </svg>
      <div className="flex gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-primary-container" />
          <span className="text-[10px] font-bold font-label text-on-surface-variant uppercase">
            {homeTeam}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-secondary border-dashed" />
          <span className="text-[10px] font-bold font-label text-on-surface-variant uppercase">
            {awayTeam}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 17: Run all shared component tests**

```bash
npx vitest run src/components/ui/__tests__/
```

- [ ] **Step 18: Commit Task 6**

```bash
git add src/components/ui/
git commit -m "feat: add shared UI components (ScoreCard, PlayerStatsTable, LiveIndicator, etc.)"
```

---

### Task 7: Fixtures & Scores Hub (Homepage `/`)

**Files:**
- Create `src/app/page.tsx`
- Create `src/app/__tests__/page.test.tsx`

- [ ] **Step 1: Write homepage test**

Create `src/app/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HomePage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: '1',
          status: 'LIVE',
          homeScore: 42,
          awayScore: 38,
          currentQuarter: 3,
          currentTime: '04:12',
          round: 12,
          venue: 'Arena',
          scheduledAt: new Date(),
          homeTeam: { name: 'Marlins', abbreviation: 'MAR', logoUrl: null },
          awayTeam: { name: 'Inferno', abbreviation: 'INF', logoUrl: null },
        },
        {
          id: '2',
          status: 'SCHEDULED',
          homeScore: 0,
          awayScore: 0,
          currentQuarter: null,
          currentTime: null,
          round: 12,
          venue: 'Stadium',
          scheduledAt: new Date(Date.now() + 86400000),
          homeTeam: { name: 'Wolves', abbreviation: 'WOL', logoUrl: null },
          awayTeam: { name: 'Harbor', abbreviation: 'HAR', logoUrl: null },
        },
      ]),
    },
  },
}));

describe('HomePage', () => {
  it('renders TODAY\'S PULSE heading', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText("TODAY'S PULSE")).toBeInTheDocument();
  });

  it('renders LIVE ACTION section when live matches exist', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('LIVE ACTION')).toBeInTheDocument();
  });

  it('renders UPCOMING FIXTURES section', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('UPCOMING FIXTURES')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run homepage test (expect fail)**

```bash
npx vitest run src/app/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement homepage**

Create `src/app/page.tsx`:

Reference: `fixtures-scores-hub/index.html`. Hero header with "TODAY'S PULSE", live action cards grid, upcoming fixtures with featured "Match of the Day" kinetic-gradient card.

```tsx
import { prisma } from '@/lib/db';
import { ScoreCard } from '@/components/ui/ScoreCard';
import Link from 'next/link';

export default async function HomePage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const matches = await prisma.match.findMany({
    where: {
      scheduledAt: { gte: today, lt: tomorrow },
    },
    include: {
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const liveMatches = matches.filter((m) => m.status === 'LIVE');
  const upcomingMatches = matches.filter((m) => m.status === 'SCHEDULED');
  const completedMatches = matches.filter((m) => m.status === 'COMPLETED');
  const featured = upcomingMatches[0];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Hero Header */}
      <section className="mb-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-secondary font-bold font-label text-sm uppercase tracking-widest">
              Game Day Hub
            </span>
            <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary mt-2">
              TODAY&apos;S PULSE
            </h1>
          </div>
        </div>
      </section>

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-secondary animate-pulse" />
            <h2 className="text-xl font-bold font-headline text-primary">LIVE ACTION</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {liveMatches.map((match) => (
              <ScoreCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Fixtures */}
      <section className="mb-20">
        <h2 className="text-xl font-bold font-headline text-primary mb-6">UPCOMING FIXTURES</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Featured Match */}
          {featured && (
            <Link
              href={`/match/${featured.id}`}
              className="md:col-span-2 bg-gradient-to-br from-primary to-primary-container rounded-2xl p-8 text-white flex flex-col justify-between min-h-[300px] shadow-2xl"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-lime-400 font-black font-label text-xs uppercase tracking-widest">
                    Match of the Day
                  </span>
                  <h3 className="text-3xl font-black font-headline tracking-tighter italic uppercase">
                    {featured.homeTeam.name} vs {featured.awayTeam.name}
                  </h3>
                </div>
                <div className="text-right">
                  <span className="block text-2xl font-bold font-headline">
                    {new Date(featured.scheduledAt).toLocaleTimeString('en-AU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {featured.venue && (
                    <span className="text-[10px] uppercase font-label text-slate-400">
                      {featured.venue}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-around py-8">
                <div className="text-center">
                  <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
                    <span className="text-3xl font-black italic font-headline">
                      {featured.homeTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <span className="font-bold font-headline uppercase">
                    {featured.homeTeam.name}
                  </span>
                </div>
                <div className="text-lime-400 font-black text-4xl italic px-4">VS</div>
                <div className="text-center">
                  <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
                    <span className="text-3xl font-black italic font-headline">
                      {featured.awayTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <span className="font-bold font-headline uppercase">
                    {featured.awayTeam.name}
                  </span>
                </div>
              </div>
            </Link>
          )}

          {/* Side Fixtures */}
          <div className="flex flex-col gap-4">
            {upcomingMatches.slice(featured ? 1 : 0, 4).map((match) => (
              <Link
                key={match.id}
                href={`/match/${match.id}`}
                className="bg-surface-container rounded-xl p-4 flex items-center justify-between group hover:bg-surface-container-high transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                    <span className="font-black italic text-primary font-headline">
                      {match.homeTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
                      {new Date(match.scheduledAt).toLocaleTimeString('en-AU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="text-sm font-bold font-headline text-primary">
                      {match.homeTeam.abbreviation} v {match.awayTeam.abbreviation}
                    </div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">
                  calendar_today
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Completed */}
      {completedMatches.length > 0 && (
        <section className="mb-16">
          <h2 className="text-xl font-bold font-headline text-primary mb-6">RESULTS</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {completedMatches.map((match) => (
              <ScoreCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run homepage test (expect pass)**

```bash
npx vitest run src/app/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 7**

```bash
git add src/app/page.tsx src/app/__tests__/page.test.tsx
git commit -m "feat: add fixtures & scores hub homepage"
```

---

### Task 8: Box Score Page (`/match/[matchId]`)

**Files:**
- Create `src/app/match/[matchId]/page.tsx`
- Create `src/app/match/[matchId]/__tests__/page.test.tsx`

- [ ] **Step 1: Write box score page test**

Create `src/app/match/[matchId]/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MatchPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: '1',
        status: 'COMPLETED',
        homeScore: 64,
        awayScore: 58,
        currentQuarter: null,
        currentTime: null,
        round: 12,
        venue: 'Stadium Arena',
        scheduledAt: new Date(),
        homeTeam: { name: 'Thunder', abbreviation: 'THU', logoUrl: null, slug: 'thunder' },
        awayTeam: { name: 'Lightning', abbreviation: 'LIG', logoUrl: null, slug: 'lightning' },
        quarters: [
          { quarter: 1, homeScore: 16, awayScore: 14 },
          { quarter: 2, homeScore: 12, awayScore: 18 },
          { quarter: 3, homeScore: 20, awayScore: 12 },
          { quarter: 4, homeScore: 16, awayScore: 14 },
        ],
        playerStats: [
          {
            id: 'ps1',
            player: { id: 'p1', name: 'Elena Rodriguez', position: 'GS', photoUrl: null, teamId: 'home' },
            goals: 42, attempts: 45, goalAssists: 0, intercepts: 0,
            deflections: 1, rebounds: 4, penalties: 0, feeds: 2,
            centrePassReceives: 0, turnovers: 1, minutesPlayed: 60,
          },
        ],
        scoreFlow: [
          { period: 1, homeScore: 1, awayScore: 0 },
          { period: 1, homeScore: 2, awayScore: 1 },
        ],
      }),
    },
  },
}));

describe('MatchPage', () => {
  it('renders team names in hero', async () => {
    const page = await MatchPage({ params: { matchId: '1' } });
    render(page);
    expect(screen.getByText(/THUNDER/)).toBeInTheDocument();
    expect(screen.getByText(/LIGHTNING/)).toBeInTheDocument();
  });

  it('renders final score', async () => {
    const page = await MatchPage({ params: { matchId: '1' } });
    render(page);
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
  });

  it('renders player stats table', async () => {
    const page = await MatchPage({ params: { matchId: '1' } });
    render(page);
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/match/[matchId]/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement box score page**

Create `src/app/match/[matchId]/page.tsx`:

Reference: `box-score-player-stats/index.html`. Hero header with team names and final score, 4-column grid (3+1 sidebar), player stats table, bento stat cards, MVP card, quarter score bars.

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PlayerStatsTable } from '@/components/ui/PlayerStatsTable';
import { QuarterScoreBar } from '@/components/ui/QuarterScoreBar';
import { MatchMomentum } from '@/components/ui/MatchMomentum';
import { LiveIndicator } from '@/components/ui/LiveIndicator';

interface MatchPageProps {
  params: { matchId: string };
}

export default async function MatchPage({ params }: MatchPageProps) {
  const match = await prisma.match.findUnique({
    where: { id: params.matchId },
    include: {
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      quarters: { orderBy: { quarter: 'asc' } },
      playerStats: {
        include: { player: true },
        orderBy: { goals: 'desc' },
      },
      scoreFlow: { orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }] },
    },
  });

  if (!match) notFound();

  const homePlayerStats = match.playerStats.filter(
    (ps) => ps.player.teamId === match.homeTeamId
  );
  const awayPlayerStats = match.playerStats.filter(
    (ps) => ps.player.teamId === match.awayTeamId
  );

  // Find MVP: highest goals among shooters, or highest intercepts among defenders
  const mvp = match.playerStats.length > 0 ? match.playerStats[0] : null;

  const isLive = match.status === 'LIVE';

  return (
    <div className="max-w-7xl mx-auto">
      {/* Hero Header */}
      <section className="mb-12">
        <div className="flex flex-col md:flex-row justify-between items-end gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              {isLive && <LiveIndicator />}
              <span className="text-on-surface-variant text-xs font-semibold font-label tracking-widest uppercase">
                Round {match.round} {match.venue && `\u2022 ${match.venue}`}
              </span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary-container leading-none uppercase">
              {match.homeTeam.name} vs{' '}
              <span className="text-secondary">{match.awayTeam.name}</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 md:gap-8">
            <div className="text-right">
              <p className="text-xs font-bold font-label text-on-surface-variant uppercase tracking-widest">
                {isLive ? `Q${match.currentQuarter}` : 'Final Score'}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-4xl font-black font-headline text-primary-container">
                  {match.homeScore}
                </span>
                <span className="text-2xl font-bold text-outline-variant">-</span>
                <span className="text-4xl font-black font-headline text-secondary">
                  {match.awayScore}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Column: Tables */}
        <div className="xl:col-span-3 space-y-8">
          <PlayerStatsTable
            teamName={match.homeTeam.name}
            players={homePlayerStats.map((ps) => ({
              id: ps.id,
              name: ps.player.name,
              position: ps.player.position,
              photoUrl: ps.player.photoUrl,
              goals: ps.goals,
              attempts: ps.attempts,
              goalAssists: ps.goalAssists,
              intercepts: ps.intercepts,
              deflections: ps.deflections,
              rebounds: ps.rebounds,
              penalties: ps.penalties,
              feeds: ps.feeds,
              centrePassReceives: ps.centrePassReceives,
              turnovers: ps.turnovers,
              minutesPlayed: ps.minutesPlayed,
            }))}
          />

          <PlayerStatsTable
            teamName={match.awayTeam.name}
            players={awayPlayerStats.map((ps) => ({
              id: ps.id,
              name: ps.player.name,
              position: ps.player.position,
              photoUrl: ps.player.photoUrl,
              goals: ps.goals,
              attempts: ps.attempts,
              goalAssists: ps.goalAssists,
              intercepts: ps.intercepts,
              deflections: ps.deflections,
              rebounds: ps.rebounds,
              penalties: ps.penalties,
              feeds: ps.feeds,
              centrePassReceives: ps.centrePassReceives,
              turnovers: ps.turnovers,
              minutesPlayed: ps.minutesPlayed,
            }))}
          />
        </div>

        {/* Right Column: Sidebar */}
        <div className="space-y-6">
          {/* MVP Card */}
          {mvp && (
            <div className="bg-surface-container-highest rounded-xl p-6 border-l-4 border-secondary">
              <div className="flex justify-between items-start mb-6">
                <span className="bg-secondary text-white text-[10px] font-black px-2 py-1 rounded font-label uppercase tracking-tighter">
                  Match MVP
                </span>
                <span
                  className="material-symbols-outlined text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  star
                </span>
              </div>
              <div className="flex flex-col items-center text-center">
                <h3 className="font-headline text-xl font-black text-primary-container uppercase">
                  {mvp.player.name}
                </h3>
                <p className="font-label text-xs text-on-surface-variant font-bold uppercase tracking-widest mt-1">
                  {mvp.player.position}
                </p>
                <div className="grid grid-cols-2 w-full gap-4 mt-8">
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                      Goals
                    </span>
                    <span className="text-2xl font-black font-headline text-secondary">
                      {mvp.goals}
                    </span>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                      Reb
                    </span>
                    <span className="text-2xl font-black font-headline text-primary-container">
                      {mvp.rebounds}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quarter Score Bars */}
          {match.quarters.length > 0 && (
            <div className="bg-surface-container-low rounded-xl p-6">
              <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-6">
                Quarter Breakdown
              </h4>
              <QuarterScoreBar quarters={match.quarters} />
            </div>
          )}

          {/* Match Momentum */}
          {match.scoreFlow.length > 0 && (
            <MatchMomentum
              scoreFlow={match.scoreFlow}
              homeTeam={match.homeTeam.name}
              awayTeam={match.awayTeam.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/match/[matchId]/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 8**

```bash
git add src/app/match/
git commit -m "feat: add box score page with player stats and match momentum"
```

---

### Task 9: League Standings (`/standings`)

**Files:**
- Create `src/app/standings/page.tsx`
- Create `src/app/standings/__tests__/page.test.tsx`

- [ ] **Step 1: Write standings page test**

Create `src/app/standings/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StandingsPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    standing: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: '1',
          rank: 1,
          played: 12,
          wins: 11,
          losses: 1,
          draws: 0,
          goalsFor: 645,
          goalsAgainst: 412,
          goalPercentage: 156.5,
          points: 44,
          team: { name: 'Vipers Athletics', slug: 'vipers-athletics', abbreviation: 'VIP', logoUrl: null },
        },
        {
          id: '2',
          rank: 2,
          played: 12,
          wins: 10,
          losses: 2,
          draws: 0,
          goalsFor: 598,
          goalsAgainst: 480,
          goalPercentage: 124.5,
          points: 40,
          team: { name: 'Starlight Gems', slug: 'starlight-gems', abbreviation: 'STA', logoUrl: null },
        },
      ]),
    },
  },
}));

describe('StandingsPage', () => {
  it('renders standings heading', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText(/Standings/i)).toBeInTheDocument();
  });

  it('renders team names', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('Vipers Athletics')).toBeInTheDocument();
    expect(screen.getByText('Starlight Gems')).toBeInTheDocument();
  });

  it('renders column headers', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('GP')).toBeInTheDocument();
    expect(screen.getByText('Pts')).toBeInTheDocument();
  });

  it('renders points values', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/standings/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement standings page**

Create `src/app/standings/page.tsx`:

Reference: `league-standings/index.html`. Kinetic-gradient table header, rank column with green left border for top teams, bento featured stats below.

```tsx
import { prisma } from '@/lib/db';
import Link from 'next/link';

export default async function StandingsPage() {
  const standings = await prisma.standing.findMany({
    include: {
      team: { select: { name: true, slug: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { rank: 'asc' },
  });

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <section className="mb-12 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <span className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-xs font-bold font-label uppercase tracking-widest mb-4">
            <span className="w-2 h-2 bg-secondary rounded-full animate-pulse" />
            Season 2026
          </span>
          <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary uppercase leading-none">
            League <span className="text-on-tertiary-container">Standings</span>
          </h1>
        </div>
      </section>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-2xl mb-8">
        <div className="bg-gradient-to-br from-primary to-primary-container p-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-secondary-fixed">leaderboard</span>
            <h3 className="text-white font-headline font-bold text-lg uppercase tracking-tight">
              Current Rankings
            </h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant">
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest">Rank</th>
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest">Team</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GP</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">W</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">L</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">D</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GF</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GA</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">G%</th>
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest text-right">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {standings.map((s) => {
                const isTop = s.rank <= 2;
                return (
                  <tr key={s.id} className="group hover:bg-surface transition-colors relative">
                    <td className="py-6 px-6 relative">
                      {isTop && (
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.rank === 1 ? 'bg-secondary shadow-[0_0_12px_rgba(0,110,10,0.5)]' : 'bg-secondary/60'}`} />
                      )}
                      <span className="text-2xl font-black font-headline text-primary">
                        {String(s.rank).padStart(2, '0')}
                      </span>
                    </td>
                    <td className="py-6 px-6">
                      <Link href={`/team/${s.team.slug}`} className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-white font-black text-xl italic font-headline shadow-inner">
                          {s.team.abbreviation.charAt(0)}
                        </div>
                        <div className="font-headline font-bold text-primary text-lg leading-tight">
                          {s.team.name}
                        </div>
                      </Link>
                    </td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-primary">{s.played}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-secondary">{s.wins}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-error">{s.losses}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-on-surface-variant">{s.draws}</td>
                    <td className="py-6 px-4 text-center font-label text-primary">{s.goalsFor}</td>
                    <td className="py-6 px-4 text-center font-label text-primary">{s.goalsAgainst}</td>
                    <td className="py-6 px-4 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-bold font-headline ${isTop ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}`}>
                        {s.goalPercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-6 px-6 text-right font-black font-headline text-2xl text-primary tracking-tighter">
                      {s.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/standings/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 9**

```bash
git add src/app/standings/
git commit -m "feat: add league standings page with rankings table"
```

---

### Task 10: Team Profile (`/team/[teamSlug]`)

**Files:**
- Create `src/app/team/[teamSlug]/page.tsx`
- Create `src/app/team/[teamSlug]/__tests__/page.test.tsx`

- [ ] **Step 1: Write team profile test**

Create `src/app/team/[teamSlug]/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    team: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't1',
        name: 'Vipers Athletics',
        slug: 'vipers-athletics',
        abbreviation: 'VIP',
        logoUrl: null,
        players: [
          { id: 'p1', name: 'Maya Sterling', position: 'GS', photoUrl: null },
          { id: 'p2', name: 'Elena Rodriguez', position: 'GA', photoUrl: null },
        ],
        standings: [
          { rank: 1, played: 12, wins: 11, losses: 1, draws: 0, goalsFor: 645, goalsAgainst: 412, goalPercentage: 156.5, points: 44 },
        ],
        homeMatches: [
          { id: 'm1', status: 'COMPLETED', homeScore: 62, awayScore: 44, scheduledAt: new Date(), round: 10, venue: 'Arena', awayTeam: { name: 'Titans', abbreviation: 'TIT' } },
        ],
        awayMatches: [],
      }),
    },
  },
}));

describe('TeamPage', () => {
  it('renders team name', async () => {
    const page = await TeamPage({ params: { teamSlug: 'vipers-athletics' } });
    render(page);
    expect(screen.getByText(/VIPERS/)).toBeInTheDocument();
  });

  it('renders roster', async () => {
    const page = await TeamPage({ params: { teamSlug: 'vipers-athletics' } });
    render(page);
    expect(screen.getByText('Maya Sterling')).toBeInTheDocument();
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
  });

  it('renders ranking badge', async () => {
    const page = await TeamPage({ params: { teamSlug: 'vipers-athletics' } });
    render(page);
    expect(screen.getByText(/Ranking #1/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/team/[teamSlug]/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement team profile page**

Create `src/app/team/[teamSlug]/page.tsx`:

Reference: `team-profile-vipers/index.html`. Kinetic-gradient hero with team badge, stats grid, recent form horizontal scroll, roster table, upcoming fixtures sidebar.

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import Link from 'next/link';

interface TeamPageProps {
  params: { teamSlug: string };
}

export default async function TeamPage({ params }: TeamPageProps) {
  const team = await prisma.team.findUnique({
    where: { slug: params.teamSlug },
    include: {
      players: { orderBy: { name: 'asc' } },
      standings: { take: 1 },
      homeMatches: {
        include: { awayTeam: { select: { name: true, abbreviation: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
      awayMatches: {
        include: { homeTeam: { select: { name: true, abbreviation: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!team) notFound();

  const standing = team.standings[0];
  const allMatches = [
    ...team.homeMatches.map((m) => ({ ...m, opponent: m.awayTeam.name, isHome: true })),
    ...team.awayMatches.map((m) => ({ ...m, opponent: m.homeTeam.name, isHome: false })),
  ].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const recentResults = allMatches.filter((m) => m.status === 'COMPLETED').slice(0, 5);
  const upcoming = allMatches.filter((m) => m.status === 'SCHEDULED').slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary to-primary-container rounded-xl overflow-hidden relative min-h-[400px] flex items-center p-8 md:p-12 text-white shadow-2xl">
        <div className="relative z-10 w-full grid md:grid-cols-2 gap-12 items-center">
          <div className="flex items-center gap-8">
            <div className="w-32 h-32 md:w-48 md:h-48 bg-white/10 backdrop-blur-xl border-4 border-lime-400 rounded-full flex items-center justify-center transform -rotate-12 shadow-inner">
              <span className="font-headline font-black text-7xl md:text-9xl text-lime-400 italic tracking-tighter">
                {team.abbreviation.charAt(0)}
              </span>
            </div>
            <div>
              {standing && (
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-secondary text-white font-label text-xs font-bold tracking-widest uppercase mb-4">
                  League Ranking #{standing.rank}
                </div>
              )}
              <h1 className="font-headline font-black text-5xl md:text-7xl italic leading-none mb-4 uppercase">
                {team.name.split(' ').map((word, i) => (
                  <span key={i}>
                    {word}
                    {i < team.name.split(' ').length - 1 && <br />}
                  </span>
                ))}
              </h1>
            </div>
          </div>
          {standing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Record</span>
                <span className="font-headline font-bold text-4xl text-white">
                  {standing.wins}-{standing.losses}-{standing.draws}
                </span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Points</span>
                <span className="font-headline font-bold text-4xl text-lime-400">{standing.points}</span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goal %</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalPercentage.toFixed(1)}%</span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goals For</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalsFor}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent Form */}
      {recentResults.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-headline font-bold text-2xl text-primary flex items-center gap-3">
            <span className="w-1 h-8 bg-secondary rounded-full" />
            Recent Form
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {recentResults.map((m) => {
              const teamScore = m.isHome ? m.homeScore : m.awayScore;
              const oppScore = m.isHome ? m.awayScore : m.homeScore;
              const won = teamScore > oppScore;
              return (
                <Link
                  key={m.id}
                  href={`/match/${m.id}`}
                  className={`flex-shrink-0 flex items-center gap-3 px-6 py-4 bg-surface-container-lowest rounded-xl shadow-sm border-b-2 ${
                    won ? 'border-secondary' : 'border-error'
                  }`}
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${won ? 'bg-secondary' : 'bg-error'}`}>
                    {won ? 'W' : 'L'}
                  </span>
                  <div>
                    <p className="font-headline font-bold text-sm">vs {m.opponent}</p>
                    <p className="font-label text-xs text-on-surface-variant">{teamScore} - {oppScore}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Roster + Upcoming */}
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Full Roster</h2>
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-high border-b border-outline-variant">
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Player</th>
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Pos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {team.players.map((player) => (
                  <tr key={player.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="p-4">
                      <p className="font-body font-bold text-primary">{player.name}</p>
                    </td>
                    <td className="p-4">
                      <span className="bg-primary-container text-on-primary-fixed-variant px-2 py-1 rounded text-xs font-black font-label">
                        {player.position}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Upcoming Fixtures</h2>
          <div className="space-y-4">
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/match/${m.id}`}
                className="block bg-surface-container-lowest p-5 rounded-xl border-l-4 border-secondary shadow-sm"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-label text-xs font-black text-secondary uppercase tracking-widest">
                      {m.isHome ? 'Home' : 'Away'}
                    </p>
                    <p className="font-headline font-bold text-lg mt-1">vs {m.opponent}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-label text-xs font-bold text-on-surface-variant">
                      {new Date(m.scheduledAt).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="font-body font-black text-primary">
                      {new Date(m.scheduledAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/team/[teamSlug]/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 10**

```bash
git add src/app/team/
git commit -m "feat: add team profile page with hero, roster, and recent form"
```

---

### Task 11: Teams Directory (`/teams`)

**Files:**
- Create `src/app/teams/page.tsx`
- Create `src/app/teams/__tests__/page.test.tsx`

- [ ] **Step 1: Write teams directory test**

Create `src/app/teams/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamsPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    team: {
      findMany: vi.fn().mockResolvedValue([
        { id: '1', name: 'Melbourne Vixens', slug: 'melbourne-vixens', abbreviation: 'VIX', logoUrl: null, primaryColor: '#FF0090' },
        { id: '2', name: 'West Coast Fever', slug: 'west-coast-fever', abbreviation: 'FEV', logoUrl: null, primaryColor: '#00B140' },
        { id: '3', name: 'Queensland Firebirds', slug: 'queensland-firebirds', abbreviation: 'FIR', logoUrl: null, primaryColor: '#FF6B00' },
      ]),
    },
  },
}));

describe('TeamsPage', () => {
  it('renders heading', async () => {
    const page = await TeamsPage();
    render(page);
    expect(screen.getByText(/Teams/i)).toBeInTheDocument();
  });

  it('renders all team names', async () => {
    const page = await TeamsPage();
    render(page);
    expect(screen.getByText('Melbourne Vixens')).toBeInTheDocument();
    expect(screen.getByText('West Coast Fever')).toBeInTheDocument();
    expect(screen.getByText('Queensland Firebirds')).toBeInTheDocument();
  });

  it('renders team cards as links', async () => {
    const page = await TeamsPage();
    render(page);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/team/melbourne-vixens')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/teams/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement teams directory page**

Create `src/app/teams/page.tsx`:

Simple grid of team cards linking to `/team/[slug]`. No Stitch design reference; use the same card styling patterns (surface-container-lowest, rounded-xl, shadow-sm).

```tsx
import { prisma } from '@/lib/db';
import Link from 'next/link';

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      abbreviation: true,
      logoUrl: true,
      primaryColor: true,
    },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="max-w-7xl mx-auto">
      <section className="mb-12">
        <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary uppercase">
          Teams
        </h1>
        <p className="text-on-surface-variant font-body mt-2">
          Suncorp Super Netball teams
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {teams.map((team) => (
          <Link
            key={team.id}
            href={`/team/${team.slug}`}
            className="bg-surface-container-lowest rounded-xl p-6 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-primary-container flex items-center justify-center">
                {team.logoUrl ? (
                  <img src={team.logoUrl} alt={team.name} className="w-14 h-14 object-contain" />
                ) : (
                  <span className="text-4xl font-black italic text-white font-headline">
                    {team.abbreviation.charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <h2 className="font-headline font-bold text-lg text-primary group-hover:text-secondary transition-colors">
                  {team.name}
                </h2>
                <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest mt-1">
                  {team.abbreviation}
                </p>
              </div>
              <span className="material-symbols-outlined text-outline-variant group-hover:text-secondary transition-colors">
                chevron_right
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/teams/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 11**

```bash
git add src/app/teams/
git commit -m "feat: add teams directory page with team card grid"
```
