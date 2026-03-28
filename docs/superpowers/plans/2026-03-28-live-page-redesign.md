# Live Page Redesign — Implementation Plan

> **For agentic workers:** This plan uses **team-based parallel execution** (TeamCreate).
> After Task 1 completes, dispatch Tasks 2–5 to parallel agents (one per component — each modifies a separate file with zero overlap). Task 6 wires everything together after all parallel tasks finish. Task 7 runs last.

**Goal:** Redesign the live match page with quarter-by-quarter scoring, stats tables with sorting, rich play-by-play feed with player identification, and real-time stats consumption via socket.

**Architecture:** Enhance 4 existing components (LiveScoreHero, LiveLineups, LivePlayByPlay, MatchStatsComparison) and rewire LiveGameClient to merge socket data, identify scorers, and derive quarter scores. Components are independent — one file each, no shared state.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS 4, Socket.io (existing), Vitest + React Testing Library

**Design reference:** `.superpowers/brainstorm/92505-1774618225/content/approach-a-themed.html`

---

## Execution Phases

```
Phase 1 (lead):  Task 1 — page.tsx serialization
Phase 2 (4 parallel agents):
   ├── Task 2 — LiveScoreHero     (Agent A)
   ├── Task 3 — LiveLineups       (Agent B)
   ├── Task 4 — LivePlayByPlay    (Agent C)
   └── Task 5 — MatchStatsComparison (Agent D)
Phase 3 (lead):  Task 6 — LiveGameClient orchestration
Phase 4 (lead):  Task 7 — Test updates + verification
```

## File Structure

| File | Action | Task |
|------|--------|------|
| `src/app/match/[matchId]/live/page.tsx` | Modify | 1 |
| `src/components/match/LiveScoreHero.tsx` | Modify | 2 |
| `src/components/match/LiveLineups.tsx` | Rewrite | 3 |
| `src/components/match/LivePlayByPlay.tsx` | Rewrite | 4 |
| `src/components/match/MatchStatsComparison.tsx` | Modify | 5 |
| `src/app/match/[matchId]/live/LiveGameClient.tsx` | Rewrite | 6 |
| `src/__tests__/match/live-page.test.tsx` | Modify | 7 |

---

## Task 1: Data Serialization — page.tsx

**Files:**
- Modify: `src/app/match/[matchId]/live/page.tsx`

This task adds `minutesPlayed` to player serialization and `quarters` to match serialization so the client has all data needed by the redesigned components.

- [ ] **Step 1: Add `minutesPlayed` to player serialization**

In `src/app/match/[matchId]/live/page.tsx`, find the `serializeTeam` function and add `minutesPlayed` to the returned player object. In the same function, the stats object comes from `p.matchStats[0]` which maps to the `PlayerMatchStats` model (`minutesPlayed Float @default(0)`).

```tsx
// In serializeTeam(), add to the player map return:
return {
  id: p.id,
  name: p.name,
  position: p.position,
  goals: stats?.goals ?? 0,
  attempts: stats?.attempts ?? 0,
  goalAssists: stats?.goalAssists ?? 0,
  intercepts: stats?.intercepts ?? 0,
  deflections: stats?.deflections ?? 0,
  rebounds: stats?.rebounds ?? 0,
  feeds: stats?.feeds ?? 0,
  turnovers: stats?.turnovers ?? 0,
  minutesPlayed: stats?.minutesPlayed ?? 0,
};
```

- [ ] **Step 2: Serialize quarters into match data**

Add `quarters` to the `serialized` object. The `match.quarters` is already fetched by the Prisma query (line 57: `quarters: { orderBy: { quarter: 'asc' } }`). Serialize it as a plain array:

```tsx
const serialized = {
  id: match.id,
  round: match.round,
  venue: match.venue,
  status: match.status,
  homeScore: match.homeScore,
  awayScore: match.awayScore,
  currentQuarter: match.currentQuarter,
  currentTime: match.currentTime,
  homeTeam: serializeTeam(match.homeTeam),
  awayTeam: serializeTeam(match.awayTeam),
  quarters: match.quarters.map((q) => ({
    quarter: q.quarter,
    homeScore: q.homeScore,
    awayScore: q.awayScore,
  })),
};
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `page.tsx` (there may be pre-existing errors elsewhere).

- [ ] **Step 4: Commit**

```
feat(live): serialize minutesPlayed and quarter scores for client
```

---

## Task 2: LiveScoreHero — Quarter Grid & Layout (PARALLEL)

**Files:**
- Modify: `src/components/match/LiveScoreHero.tsx`

**Context for agent:** This component renders the hero banner at the top of the live match page. It currently shows team badges, the live score, and a small live pill. The redesign adds a quarter-by-quarter score grid below the main score, enlarges the live pill, and centers the layout with a max-width constraint.

**Existing file:** `src/components/match/LiveScoreHero.tsx` — 107 lines. Keep the existing props and add `quarters`.

**Design reference:** See the `<table class="quarter-table">` in `.superpowers/brainstorm/92505-1774618225/content/approach-a-themed.html` lines 610–639.

- [ ] **Step 1: Add `QuarterData` type and `quarters` prop**

At the top of `src/components/match/LiveScoreHero.tsx`, add the type and extend the props interface:

```tsx
interface QuarterData {
  quarter: number;
  homeScore: number;
  awayScore: number;
}
```

Add to `LiveScoreHeroProps`:
```tsx
quarters?: QuarterData[];
```

Add to the destructured props:
```tsx
quarters,
```

- [ ] **Step 2: Center layout with max-width**

Replace the inner flex container (line 48):

```tsx
{/* Old */}
<div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">

{/* New */}
<div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10 max-w-[960px] mx-auto">
```

- [ ] **Step 3: Mirror team layout toward score center**

Replace the home and away team `<div>` blocks (lines 49–62 home, lines 90–103 away) with horizontal, mirrored layouts. Home team content pushes right toward the score; away team content pushes left toward the score.

Home team (replace lines 49–62):
```tsx
{/* Home team */}
<div className="flex items-center gap-4 flex-1 min-w-0 justify-end">
  <div className="w-[72px] h-[72px] rounded-full bg-white flex items-center justify-center p-2">
    <TeamBadge team={homeTeam} size={56} variant="home" />
  </div>
  <div>
    <h2 className="font-headline text-lg font-extrabold tracking-tighter uppercase italic">
      {homeTeam.name}
    </h2>
    <p className="text-on-primary-container font-label text-[10px] tracking-[2px] uppercase">
      Home Team
    </p>
  </div>
</div>
```

Away team (replace lines 90–103):
```tsx
{/* Away team */}
<div className="flex items-center gap-4 flex-1 min-w-0 flex-row-reverse justify-end">
  <div className="w-[72px] h-[72px] rounded-full bg-white flex items-center justify-center p-2">
    <TeamBadge team={awayTeam} size={56} variant="away" />
  </div>
  <div className="text-right">
    <h2 className="font-headline text-lg font-extrabold tracking-tighter uppercase italic">
      {awayTeam.name}
    </h2>
    <p className="text-on-primary-container font-label text-[10px] tracking-[2px] uppercase">
      Away Team
    </p>
  </div>
</div>
```

Key changes: both sides are now horizontal (`flex items-center`), home uses `justify-end` (content pushed right toward score), away uses `flex-row-reverse justify-end` (badge goes right, content pushed left toward score). Badge reduced from 80px to 72px (56px inner) to match the design mockup.

- [ ] **Step 4: Enlarge the live pill (inline, no LiveIndicator import)**

Replace the live pill block (lines 67–73) with a larger version:

```tsx
{isLive && (
  <div className="bg-secondary px-4 py-1.5 rounded-full flex items-center gap-2 mb-4">
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
    </span>
    <span className="font-label text-xs font-bold uppercase tracking-[0.5px] text-white">
      Q{quarter} {time && `\u2022 ${time}`}
    </span>
  </div>
)}
```

This replaces the `<LiveIndicator />` import — the pill now contains its own pulsing dot inline. Remove the `import { LiveIndicator }` line at the top of the file.

- [ ] **Step 5: Add the quarter-by-quarter grid table**

Below the closing `</div>` of the big score numbers (after line 85: the round/venue `<p>` tag), add the quarter grid. Insert it between the score `<div>` and the venue `<p>`:

```tsx
{/* Quarter-by-quarter grid */}
{quarters && quarters.length > 0 && (
  <table className="mt-2 border-separate" style={{ borderSpacing: '1px' }}>
    <thead>
      <tr>
        <th className="px-2.5 py-1 text-left text-[10px] font-bold uppercase tracking-[0.5px] text-white/40 font-label min-w-[34px]" />
        {[1, 2, 3, 4].map((q) => (
          <th
            key={q}
            className={`px-3.5 py-1 text-center text-[10px] font-bold uppercase tracking-[0.5px] font-label min-w-[40px] ${
              q === quarter
                ? 'bg-secondary/25 text-secondary-container'
                : 'text-white/40'
            }`}
            style={{ background: q === quarter ? 'rgba(0,110,10,0.25)' : 'rgba(0,31,63,0.8)' }}
          >
            Q{q}
          </th>
        ))}
        <th
          className="px-3.5 py-1 text-center text-[10px] font-extrabold uppercase tracking-[0.5px] text-white/60 font-label min-w-[40px]"
          style={{ background: 'rgba(0,31,63,0.8)' }}
        >
          T
        </th>
      </tr>
    </thead>
    <tbody>
      {[
        { abbr: homeTeam.abbreviation, side: 'home' as const },
        { abbr: awayTeam.abbreviation, side: 'away' as const },
      ].map(({ abbr, side }) => (
        <tr key={side}>
          <td
            className="px-2.5 py-1 text-left text-[10px] font-bold tracking-[0.5px] text-white/50 font-label"
            style={{ background: 'rgba(0,31,63,0.8)' }}
          >
            {abbr}
          </td>
          {[1, 2, 3, 4].map((q) => {
            const qData = quarters.find((qd) => qd.quarter === q);
            const isActive = q === quarter;
            const value = qData
              ? side === 'home'
                ? qData.homeScore
                : qData.awayScore
              : null;

            return (
              <td
                key={q}
                className={`px-3.5 py-1 text-center text-xs font-label ${
                  isActive
                    ? 'font-bold text-secondary-container'
                    : value !== null
                      ? 'text-white/60'
                      : 'text-white/20'
                }`}
                style={{
                  background: isActive
                    ? 'rgba(0,110,10,0.25)'
                    : 'rgba(0,31,63,0.8)',
                }}
              >
                {value !== null ? value : '\u2013'}
              </td>
            );
          })}
          <td
            className="px-3.5 py-1 text-center text-xs font-extrabold text-white font-label"
            style={{ background: 'rgba(0,31,63,0.8)' }}
          >
            {side === 'home' ? homeScore : awayScore}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)}
```

- [ ] **Step 6: Verify the component compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep LiveScoreHero`
Expected: No errors.

- [ ] **Step 7: Commit**

```
feat(live): redesign hero with mirrored layout, quarter grid, enlarged live pill
```

---

## Task 3: LiveLineups — Stats Table Rewrite (PARALLEL)

**Files:**
- Rewrite: `src/components/match/LiveLineups.tsx`

**Context for agent:** This component currently renders a flat player list with position-adaptive single stat labels. The redesign replaces it with proper `<table>` elements showing 6 consistent stat columns (G, ATT, AST, INT, FD), on-court/bench grouping, column sorting, and player links. It's a complete rewrite.

**Design reference:** See the `.lineup-columns` / `.stats-tbl` section in `.superpowers/brainstorm/92505-1774618225/content/approach-a-themed.html` lines 664–728.

- [ ] **Step 1: Write the complete new component**

Replace the entire contents of `src/components/match/LiveLineups.tsx` with:

```tsx
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';

interface PlayerData {
  id: string;
  name: string;
  position: string;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  feeds: number;
  turnovers: number;
  minutesPlayed: number;
}

interface TeamData {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
  players: PlayerData[];
}

interface LiveLineupsProps {
  homeTeam: TeamData;
  awayTeam: TeamData;
}

const POSITION_ORDER: Record<string, number> = {
  GS: 1, GA: 2, WA: 3, C: 4, WD: 5, GD: 6, GK: 7,
};

type StatColumn = 'G' | 'ATT' | 'AST' | 'INT' | 'FD';
type SortDirection = 'default' | 'desc' | 'asc';

interface SortState {
  column: 'player' | StatColumn;
  direction: SortDirection;
}

const STAT_KEY: Record<StatColumn, keyof PlayerData> = {
  G: 'goals',
  ATT: 'attempts',
  AST: 'goalAssists',
  INT: 'intercepts',
  FD: 'feeds',
};

const COLUMN_TOOLTIPS: Record<StatColumn, string> = {
  G: 'Goals — Successful shots scored',
  ATT: 'Attempts — Total shots taken',
  AST: 'Goal Assists — Passes to scorer',
  INT: 'Intercepts — Possessions won',
  FD: 'Feeds — Passes into circle',
};

const STAT_COLUMNS: StatColumn[] = ['G', 'ATT', 'AST', 'INT', 'FD'];

function isShooter(position: string): boolean {
  return position === 'GS' || position === 'GA';
}

function splitAndSort(
  players: PlayerData[],
  sort: SortState,
): { onCourt: PlayerData[]; bench: PlayerData[] } {
  const hasMinutesData = players.some((p) => p.minutesPlayed > 0);

  let onCourt: PlayerData[];
  let bench: PlayerData[];

  if (hasMinutesData) {
    onCourt = players.filter((p) => p.minutesPlayed > 0);
    bench = players.filter((p) => p.minutesPlayed <= 0);
  } else {
    // Fallback: first 7 by position order are "on court"
    const byPos = [...players].sort(
      (a, b) =>
        (POSITION_ORDER[a.position] ?? 99) -
        (POSITION_ORDER[b.position] ?? 99),
    );
    onCourt = byPos.slice(0, 7);
    bench = byPos.slice(7);
  }

  let sorted = [...onCourt];

  if (sort.direction === 'default') {
    // Default: GS → GK
    sorted.sort(
      (a, b) =>
        (POSITION_ORDER[a.position] ?? 99) -
        (POSITION_ORDER[b.position] ?? 99),
    );
  } else if (sort.column === 'player') {
    // GK → GS (defense first)
    sorted.sort(
      (a, b) =>
        (POSITION_ORDER[b.position] ?? 99) -
        (POSITION_ORDER[a.position] ?? 99),
    );
  } else {
    const key = STAT_KEY[sort.column as StatColumn];
    sorted.sort((a, b) => {
      const diff = (b[key] as number) - (a[key] as number);
      return sort.direction === 'desc' ? diff : -diff;
    });
  }

  return { onCourt: sorted, bench };
}

function TeamTable({
  team,
  variant,
}: {
  team: TeamData;
  variant: 'home' | 'away';
}) {
  const [sort, setSort] = useState<SortState>({
    column: 'player',
    direction: 'default',
  });

  const { onCourt, bench } = useMemo(
    () => splitAndSort(team.players, sort),
    [team.players, sort],
  );

  function handlePlayerSort() {
    setSort((prev) => {
      if (prev.column === 'player' && prev.direction !== 'default') {
        return { column: 'player', direction: 'default' };
      }
      return { column: 'player', direction: 'desc' };
    });
  }

  function handleStatSort(col: StatColumn) {
    setSort((prev) => {
      if (prev.column === col) {
        if (prev.direction === 'desc')
          return { column: col, direction: 'asc' };
        if (prev.direction === 'asc')
          return { column: col, direction: 'default' };
      }
      return { column: col, direction: 'desc' };
    });
  }

  const posClass =
    variant === 'home'
      ? 'bg-primary-container text-white'
      : 'bg-secondary text-white';
  const headerBorder =
    variant === 'home' ? 'border-secondary' : 'border-primary-container';
  const headerText =
    variant === 'home' ? 'text-secondary' : 'text-primary-container';
  const headerBg =
    variant === 'home' ? 'bg-secondary/[0.03]' : 'bg-primary-container/[0.03]';
  const headerAlign = variant === 'away' ? 'justify-end text-right' : '';

  function renderRow(player: PlayerData, isBench: boolean) {
    const rowClass = isBench
      ? 'opacity-45 hover:opacity-70 transition-opacity'
      : 'hover:bg-surface-container-low transition-colors';
    const badgeOpacity = isBench ? 'opacity-35' : '';

    return (
      <tr key={player.id} className={rowClass}>
        <td className="pl-4 pr-2 py-2.5 border-b border-outline-variant/20">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-[30px] h-[30px] rounded-full ${posClass} flex items-center justify-center text-[10px] font-bold shrink-0 font-label ${badgeOpacity}`}
            >
              {player.position}
            </span>
            <Link
              href={`/player/${player.id}`}
              className={`font-body text-[13px] font-semibold hover:text-secondary hover:underline ${
                isBench ? 'text-on-surface-variant' : 'text-on-surface'
              }`}
            >
              {player.name}
            </Link>
          </div>
        </td>
        <td
          className={`text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] ${
            !isBench && isShooter(player.position)
              ? 'text-secondary font-extrabold'
              : 'text-on-surface-variant'
          }`}
        >
          {player.goals}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.attempts}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.goalAssists}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.intercepts}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.feeds}
        </td>
      </tr>
    );
  }

  return (
    <div>
      {/* Team column header */}
      <div
        className={`flex items-center gap-2 px-4 py-2.5 font-label text-[10px] font-black uppercase tracking-[1.5px] border-b-2 ${headerBorder} ${headerText} ${headerBg} ${headerAlign}`}
      >
        <div
          className={`w-[22px] h-[22px] rounded-full ${posClass} flex items-center justify-center text-[8px] font-bold`}
        >
          {team.abbreviation.slice(0, 2)}
        </div>
        {team.name}
      </div>

      {/* On Court group label */}
      <div className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-container-low border-b border-outline-variant font-label text-[9px] font-black uppercase tracking-[2px] text-on-surface-variant">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
        On Court
      </div>

      {/* Stats table */}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th
              className="text-left pl-4 pr-2 py-2 font-label text-[9px] font-bold uppercase tracking-[0.5px] text-on-surface-variant border-b border-outline-variant cursor-pointer hover:text-secondary select-none"
              style={{
                textDecoration: 'underline dotted rgba(67,71,78,0.4)',
                textUnderlineOffset: '3px',
              }}
              title="Position — Sort by court position"
              onClick={handlePlayerSort}
            >
              Player
              {sort.column === 'player' && sort.direction !== 'default' && (
                <span className="text-[8px] ml-0.5 text-secondary">
                  {' '}
                  GK→GS
                </span>
              )}
            </th>
            {STAT_COLUMNS.map((col) => (
              <th
                key={col}
                className="text-center px-1.5 py-2 font-label text-[9px] font-bold uppercase tracking-[0.5px] text-on-surface-variant border-b border-outline-variant cursor-pointer hover:text-secondary select-none"
                style={{
                  textDecoration: 'underline dotted rgba(67,71,78,0.4)',
                  textUnderlineOffset: '3px',
                }}
                title={COLUMN_TOOLTIPS[col]}
                onClick={() => handleStatSort(col)}
              >
                {col}
                {sort.column === col && sort.direction !== 'default' && (
                  <span className="text-[8px] ml-0.5 text-secondary">
                    {sort.direction === 'desc' ? ' ▼' : ' ▲'}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{onCourt.map((p) => renderRow(p, false))}</tbody>
      </table>

      {/* Bench */}
      {bench.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-container-low border-b border-outline-variant font-label text-[9px] font-black uppercase tracking-[2px] text-on-surface-variant opacity-50">
            Bench
          </div>
          <table className="w-full border-collapse">
            <tbody>{bench.map((p) => renderRow(p, true))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function LiveLineups({ homeTeam, awayTeam }: LiveLineupsProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/15 overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-secondary text-[22px]">
          groups
        </span>
        <h3 className="font-headline text-lg font-bold">Live Lineups</h3>
      </div>
      <div className="grid grid-cols-2">
        <TeamTable team={homeTeam} variant="home" />
        <div className="border-l border-outline-variant">
          <TeamTable team={awayTeam} variant="away" />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep LiveLineups`
Expected: No errors.

- [ ] **Step 3: Commit**

```
feat(live): rewrite LiveLineups with stats tables, sorting, on-court/bench
```

---

## Task 4: LivePlayByPlay — Rich Feed Entries (PARALLEL)

**Files:**
- Rewrite: `src/components/match/LivePlayByPlay.tsx`

**Context for agent:** This component currently shows generic "Goal scored. X - Y" entries. The redesign adds team mini-badges, player names as links, score badges with team-colored backgrounds, and quarter separators. Entries are displayed newest-first.

**Design reference:** See the `.feed-panel` section in `.superpowers/brainstorm/92505-1774618225/content/approach-a-themed.html` lines 793–901.

- [ ] **Step 1: Write the complete new component**

Replace the entire contents of `src/components/match/LivePlayByPlay.tsx` with:

```tsx
'use client';

import { useRef, useEffect, Fragment } from 'react';
import Link from 'next/link';

export interface FeedEntry {
  time: string;
  quarter: number;
  scorerName?: string;
  scorerPlayerId?: string;
  teamAbbreviation: string;
  teamName: string;
  isHomeTeam: boolean;
  homeScore: number;
  awayScore: number;
}

interface LivePlayByPlayProps {
  entries: FeedEntry[];
}

export function LivePlayByPlay({ entries }: LivePlayByPlayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to top (newest) when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  const reversed = [...entries].reverse();

  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden shadow-2xl sticky top-24">
      {/* Header */}
      <div className="bg-slate-800 p-4 border-b border-slate-800 flex items-center justify-between">
        <h4 className="text-white font-headline text-sm font-bold uppercase tracking-widest flex items-center gap-2">
          <span className="material-symbols-outlined text-lime-400 text-sm">
            sensors
          </span>
          Live Feed
        </h4>
        <span className="text-[10px] text-lime-400 font-bold uppercase">
          Real-Time
        </span>
      </div>

      {/* Feed entries */}
      <div ref={scrollRef} className="h-[600px] overflow-y-auto">
        {reversed.length === 0 && (
          <p className="text-slate-500 text-sm text-center mt-8">
            Waiting for live events...
          </p>
        )}
        {reversed.map((entry, i) => {
          const showSeparator =
            i > 0 && reversed[i - 1].quarter !== entry.quarter;

          return (
            <Fragment key={i}>
              {showSeparator && (
                <div className="px-4 py-2 text-center font-label text-[10px] font-bold text-white/25 uppercase tracking-[1.5px] bg-white/[0.02] border-b border-white/[0.04]">
                  &#9654; Quarter {reversed[i - 1].quarter} Start
                </div>
              )}
              <div className="flex gap-3 px-4 py-3.5 border-b border-white/[0.04] items-start hover:bg-white/[0.03] transition-colors">
                {/* Team mini-badge */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[8px] font-extrabold shrink-0 mt-0.5 font-label border-2 ${
                    entry.isHomeTeam
                      ? 'bg-primary-container text-white border-primary-fixed-dim/30'
                      : 'bg-secondary text-white border-secondary-container/30'
                  }`}
                >
                  {entry.teamAbbreviation}
                </div>

                {/* Entry content */}
                <div className="flex-1 min-w-0">
                  <p className="font-label text-[10px] font-bold text-white/35 uppercase">
                    {entry.time} &middot; Q{entry.quarter}
                  </p>
                  <p className="font-body text-sm font-semibold text-white mt-0.5 leading-snug">
                    {entry.scorerName && entry.scorerPlayerId ? (
                      <>
                        <Link
                          href={`/player/${entry.scorerPlayerId}`}
                          className="text-white underline decoration-white/25 underline-offset-2 hover:decoration-lime-400 hover:text-lime-400"
                        >
                          {entry.scorerName}
                        </Link>{' '}
                        scored
                      </>
                    ) : (
                      <>{entry.teamName} scored</>
                    )}
                  </p>
                  {/* Score badge */}
                  <span
                    className={`inline-block mt-1.5 font-label text-[11px] font-extrabold px-2 py-0.5 rounded tracking-[0.5px] ${
                      entry.isHomeTeam
                        ? 'bg-primary-container/60 text-primary-fixed-dim'
                        : 'bg-secondary/30 text-secondary-container'
                    }`}
                  >
                    {entry.homeScore} &ndash; {entry.awayScore}
                  </span>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep LivePlayByPlay`
Expected: No errors.

- [ ] **Step 3: Commit**

```
feat(live): rich play-by-play feed with team badges, player links, score tags
```

---

## Task 5: MatchStatsComparison — Extended Stats (PARALLEL)

**Files:**
- Modify: `src/components/match/MatchStatsComparison.tsx`

**Context for agent:** This component shows horizontal bar charts comparing team stats. Currently has 4 stats (Goals, Intercepts, Deflections, Turnovers). Add 2 more (Feeds, Goal Assists) and increase bar height. The data expansion is handled by LiveGameClient (Task 6) — this task only changes the visual bar height.

- [ ] **Step 1: Increase bar height from h-2 to h-2.5 with rounded corners**

In `src/components/match/MatchStatsComparison.tsx`, find the bar container (line 43):

```tsx
{/* Old */}
<div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">

{/* New */}
<div className="h-2.5 w-full bg-surface-container-high rounded overflow-hidden flex">
```

Also add `rounded-l` to the home bar and `rounded-r` to the away bar for individual corner rounding:

```tsx
{/* Old */}
<div
  className="h-full bg-primary-container"
  style={{ width: `${homePct}%` }}
/>
<div
  className="h-full bg-secondary"
  style={{ width: `${awayPct}%` }}
/>

{/* New */}
<div
  className="h-full bg-primary-container rounded-l"
  style={{ width: `${homePct}%` }}
/>
<div
  className="h-full bg-secondary rounded-r"
  style={{ width: `${awayPct}%` }}
/>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep MatchStatsComparison`
Expected: No errors.

- [ ] **Step 3: Commit**

```
feat(live): increase match stats bar height with rounded corners
```

---

## Task 6: LiveGameClient — Orchestration & State

**Files:**
- Rewrite: `src/app/match/[matchId]/live/LiveGameClient.tsx`

**Context for agent:** This is the client component that orchestrates the live match page. It receives serialized match data from the server, connects to the WebSocket, and renders all sub-components. The redesign adds: (1) stats merging from socket into player data, (2) scorer identification from goal count diffs, (3) quarter score derivation from SSR + live data, (4) enriched feed entry building, (5) 2 additional comparison stats, (6) updated prop passing to match new component interfaces.

**Socket types:** `src/types/socket.ts` defines `StatsUpdatePayload` which includes `playerStats: Array<{ playerId, goals, attempts, goalAssists, intercepts, deflections, rebounds, penalties, feeds, centrePassReceives, turnovers, minutesPlayed }>`.

**Feed entry interface:** Exported from `src/components/match/LivePlayByPlay.tsx` as `FeedEntry` with fields: `time, quarter, scorerName?, scorerPlayerId?, teamAbbreviation, teamName, isHomeTeam, homeScore, awayScore`.

- [ ] **Step 1: Write the complete new LiveGameClient**

Replace the entire contents of `src/app/match/[matchId]/live/LiveGameClient.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useMemo, useState } from 'react';
import { useMatchSocket } from '@/hooks/useMatchSocket';
import { LiveScoreHero } from '@/components/match/LiveScoreHero';
import { LiveLineups } from '@/components/match/LiveLineups';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import {
  LivePlayByPlay,
  type FeedEntry,
} from '@/components/match/LivePlayByPlay';
import type { StatsUpdatePayload } from '@/types/socket';

interface PlayerData {
  id: string;
  name: string;
  position: string;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  feeds: number;
  turnovers: number;
  minutesPlayed: number;
}

interface TeamData {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
  players: PlayerData[];
}

interface QuarterData {
  quarter: number;
  homeScore: number;
  awayScore: number;
}

interface MatchData {
  id: string;
  round: number;
  venue: string;
  status: string;
  homeScore: number;
  awayScore: number;
  currentQuarter: number | null;
  currentTime: string | null;
  homeTeam: TeamData;
  awayTeam: TeamData;
  quarters: QuarterData[];
}

interface LiveGameClientProps {
  match: MatchData;
}

// ─── Helpers ───

function mergePlayerStats(
  players: PlayerData[],
  socketStats: StatsUpdatePayload | null,
): PlayerData[] {
  if (!socketStats) return players;
  return players.map((player) => {
    const update = socketStats.playerStats.find(
      (s) => s.playerId === player.id,
    );
    if (!update) return player;
    return {
      ...player,
      goals: update.goals,
      attempts: update.attempts,
      goalAssists: update.goalAssists,
      intercepts: update.intercepts,
      deflections: update.deflections,
      rebounds: update.rebounds,
      feeds: update.feeds,
      turnovers: update.turnovers,
      minutesPlayed: update.minutesPlayed,
    };
  });
}

function buildLiveQuarters(
  ssrQuarters: QuarterData[],
  currentHomeScore: number,
  currentAwayScore: number,
  currentQuarter: number | null,
): QuarterData[] {
  const completed = [...ssrQuarters];

  if (!currentQuarter) return completed;

  // If the current quarter is already in the completed data, return as-is
  if (completed.some((q) => q.quarter === currentQuarter)) return completed;

  // Derive current quarter score from total minus completed quarters
  const completedHome = completed.reduce((s, q) => s + q.homeScore, 0);
  const completedAway = completed.reduce((s, q) => s + q.awayScore, 0);

  return [
    ...completed,
    {
      quarter: currentQuarter,
      homeScore: currentHomeScore - completedHome,
      awayScore: currentAwayScore - completedAway,
    },
  ];
}

const sumStat = (players: PlayerData[], key: keyof PlayerData) =>
  players.reduce((sum, p) => sum + (Number(p[key]) || 0), 0);

// ─── Component ───

export function LiveGameClient({ match }: LiveGameClientProps) {
  const { score, playerStats, matchStatus, scoreFlow } = useMatchSocket(
    match.id,
  );

  // ── Live scores ──
  const homeScore = score?.homeScore ?? match.homeScore;
  const awayScore = score?.awayScore ?? match.awayScore;
  const quarter = score?.currentQuarter ?? match.currentQuarter;
  const time = score?.currentTime ?? match.currentTime;
  const isLive = matchStatus?.status === 'LIVE' || match.status === 'LIVE';

  // ── Merge socket stats into player data ──
  const homePlayers = mergePlayerStats(match.homeTeam.players, playerStats);
  const awayPlayers = mergePlayerStats(match.awayTeam.players, playerStats);

  // ── Derive quarter scores ──
  const quarters = buildLiveQuarters(
    match.quarters,
    homeScore,
    awayScore,
    quarter,
  );

  // ── Scorer identification ──
  // Track previous goal counts to detect who scored
  const prevGoalsRef = useRef<Map<string, number>>(new Map());
  const [scorerLog, setScorerLog] = useState<
    Array<{ playerId: string; name: string; teamId: string }>
  >([]);

  // Initialize prev goals from SSR data
  useEffect(() => {
    const map = new Map<string, number>();
    for (const p of [
      ...match.homeTeam.players,
      ...match.awayTeam.players,
    ]) {
      map.set(p.id, p.goals);
    }
    prevGoalsRef.current = map;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect new goals on stats update
  useEffect(() => {
    if (!playerStats) return;
    const prev = prevGoalsRef.current;
    const allPlayers = [
      ...match.homeTeam.players,
      ...match.awayTeam.players,
    ];
    const newScorers: Array<{
      playerId: string;
      name: string;
      teamId: string;
    }> = [];

    for (const stat of playerStats.playerStats) {
      const prevGoalCount = prev.get(stat.playerId) ?? 0;
      if (stat.goals > prevGoalCount) {
        const player = allPlayers.find((p) => p.id === stat.playerId);
        const teamId = match.homeTeam.players.some(
          (p) => p.id === stat.playerId,
        )
          ? match.homeTeam.id
          : match.awayTeam.id;

        // One entry per goal scored (handles multi-goal updates)
        for (let i = 0; i < stat.goals - prevGoalCount; i++) {
          newScorers.push({
            playerId: stat.playerId,
            name: player?.name ?? 'Unknown',
            teamId,
          });
        }
      }
      prev.set(stat.playerId, stat.goals);
    }

    if (newScorers.length > 0) {
      setScorerLog((prev) => [...prev, ...newScorers]);
    }
  }, [playerStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build enriched feed entries ──
  const feedEntries: FeedEntry[] = useMemo(() => {
    // Split scorer log by team for ordered matching
    const homeScorers = scorerLog.filter(
      (s) => s.teamId === match.homeTeam.id,
    );
    const awayScorers = scorerLog.filter(
      (s) => s.teamId === match.awayTeam.id,
    );

    let homeIdx = 0;
    let awayIdx = 0;

    return scoreFlow.map((flow) => {
      const isHome = flow.scoringTeamId === match.homeTeam.id;
      let scorerName: string | undefined;
      let scorerPlayerId: string | undefined;

      if (isHome && homeIdx < homeScorers.length) {
        scorerName = homeScorers[homeIdx].name;
        scorerPlayerId = homeScorers[homeIdx].playerId;
        homeIdx++;
      } else if (!isHome && awayIdx < awayScorers.length) {
        scorerName = awayScorers[awayIdx].name;
        scorerPlayerId = awayScorers[awayIdx].playerId;
        awayIdx++;
      }

      const teamAbbr = isHome
        ? match.homeTeam.abbreviation
        : match.awayTeam.abbreviation;
      const teamName = isHome ? match.homeTeam.name : match.awayTeam.name;

      const mins = Math.floor(flow.periodSeconds / 60);
      const secs = String(flow.periodSeconds % 60).padStart(2, '0');

      return {
        time: `${mins}:${secs}`,
        quarter: flow.period,
        scorerName,
        scorerPlayerId,
        teamAbbreviation: teamAbbr,
        teamName,
        isHomeTeam: isHome,
        homeScore: flow.homeScore,
        awayScore: flow.awayScore,
      };
    });
  }, [scoreFlow, scorerLog, match.homeTeam, match.awayTeam]);

  // ── Comparison stats (6 stats) ──
  const comparisonStats = [
    {
      label: 'Goals',
      homeValue: sumStat(homePlayers, 'goals'),
      awayValue: sumStat(awayPlayers, 'goals'),
    },
    {
      label: 'Intercepts',
      homeValue: sumStat(homePlayers, 'intercepts'),
      awayValue: sumStat(awayPlayers, 'intercepts'),
    },
    {
      label: 'Deflections',
      homeValue: sumStat(homePlayers, 'deflections'),
      awayValue: sumStat(awayPlayers, 'deflections'),
    },
    {
      label: 'Turnovers',
      homeValue: sumStat(homePlayers, 'turnovers'),
      awayValue: sumStat(awayPlayers, 'turnovers'),
    },
    {
      label: 'Feeds',
      homeValue: sumStat(homePlayers, 'feeds'),
      awayValue: sumStat(awayPlayers, 'feeds'),
    },
    {
      label: 'Goal Assists',
      homeValue: sumStat(homePlayers, 'goalAssists'),
      awayValue: sumStat(awayPlayers, 'goalAssists'),
    },
  ];

  // ── Render ──
  return (
    <section className="p-4 md:p-8 space-y-8 max-w-7xl mx-auto">
      <LiveScoreHero
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeScore={homeScore}
        awayScore={awayScore}
        round={match.round}
        venue={match.venue}
        currentQuarter={quarter}
        currentTime={time}
        isLive={isLive}
        liveScore={score}
        matchStatus={matchStatus}
        quarters={quarters}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <LiveLineups
            homeTeam={{ ...match.homeTeam, players: homePlayers }}
            awayTeam={{ ...match.awayTeam, players: awayPlayers }}
          />
          <MatchStatsComparison stats={comparisonStats} />
        </div>

        <div className="lg:col-span-1">
          <LivePlayByPlay entries={feedEntries} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No type errors in the live page files.

- [ ] **Step 3: Commit**

```
feat(live): wire LiveGameClient with stats merging, scorer ID, and quarter derivation
```

---

## Task 7: Test Updates

**Files:**
- Modify: `src/__tests__/match/live-page.test.tsx`

**Context for agent:** The existing test renders `LiveGameClient` with mock data. The interface has changed: `MatchData` now includes `quarters: QuarterData[]` and `PlayerData` now includes `minutesPlayed: number`. Also, `LiveLineups` now receives team objects instead of flat arrays, so the rendered output structure differs slightly.

- [ ] **Step 1: Update mock data with new fields**

In `src/__tests__/match/live-page.test.tsx`, update `mockMatch` to include `quarters` and `minutesPlayed`:

```tsx
const mockMatch = {
  id: 'match-1',
  round: 5,
  venue: 'Melbourne Arena',
  status: 'LIVE',
  homeScore: 42,
  awayScore: 38,
  currentQuarter: 3,
  currentTime: '12:45',
  homeTeam: {
    id: 'team-1',
    name: 'Viper Hawks',
    abbreviation: 'VH',
    logoUrl: null,
    players: [
      {
        id: 'p1',
        name: 'Sarah Jenkins',
        position: 'GS',
        goals: 18,
        attempts: 20,
        goalAssists: 0,
        intercepts: 0,
        deflections: 0,
        rebounds: 2,
        feeds: 0,
        turnovers: 1,
        minutesPlayed: 30,
      },
      {
        id: 'p2',
        name: 'Jessica Chen',
        position: 'C',
        goals: 0,
        attempts: 0,
        goalAssists: 5,
        intercepts: 2,
        deflections: 1,
        rebounds: 0,
        feeds: 18,
        turnovers: 3,
        minutesPlayed: 30,
      },
    ],
  },
  awayTeam: {
    id: 'team-2',
    name: 'Nova Stars',
    abbreviation: 'NS',
    logoUrl: null,
    players: [
      {
        id: 'p3',
        name: 'Linda Blair',
        position: 'GS',
        goals: 22,
        attempts: 24,
        goalAssists: 0,
        intercepts: 0,
        deflections: 0,
        rebounds: 1,
        feeds: 0,
        turnovers: 2,
        minutesPlayed: 30,
      },
    ],
  },
  quarters: [
    { quarter: 1, homeScore: 14, awayScore: 12 },
    { quarter: 2, homeScore: 16, awayScore: 14 },
  ],
};
```

- [ ] **Step 2: Update assertions for new structure**

The test assertions should still pass without changes because:
- Team names still render (via the team objects passed to LiveLineups)
- Scores still render in the hero
- Player names still render (LiveLineups renders them from team.players)
- "Key Match Stats" and "Live Feed" section titles are unchanged

Verify: player names now render as `<Link>` elements (clickable) — the text is still findable by `screen.getByText()`.

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run src/__tests__/match/live-page.test.tsx --reporter=verbose`
Expected: All tests pass.

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: Full suite passes (or only pre-existing failures unrelated to live page).

- [ ] **Step 4: Commit**

```
test(live): update live page test mock data for new interfaces
```

---

## Verification Checklist

After all tasks complete, verify the full page works:

- [ ] Run `npx tsc --noEmit` — no type errors
- [ ] Run `npx vitest run` — tests pass
- [ ] Run `npm run dev` — page loads at `/match/[matchId]/live`
- [ ] Start simulation (`SIMULATION_MODE=true`) — live data flows correctly
- [ ] Quarter grid updates as quarters progress
- [ ] Player stats table shows on-court/bench split
- [ ] Column sorting works (click stat headers)
- [ ] Feed shows team badges, player names (when identified), score tags
- [ ] Feed shows quarter separators between quarters
- [ ] Player names in lineups and feed link to `/player/[playerId]`
- [ ] Stats comparison shows 6 stats (Goals, Intercepts, Deflections, Turnovers, Feeds, Goal Assists)
