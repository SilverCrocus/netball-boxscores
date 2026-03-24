# Player Profile Page — Implementation Plan

> **For agentic workers:** Use a **team of agents** (TeamCreate) to implement this plan. Tasks are designed for parallel execution where dependencies allow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable player profile pages with position-adaptive stats, charts, and game log to NETPULSE.

**Architecture:** Expand Prisma Player model with bio fields from TheSportsDB, create a `/player/[playerId]` route with position-aware components (shooter/defender/mid-court), and link from team roster. CSS/SVG charts, no external charting library.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Prisma 6.x, Vitest

**Spec:** `docs/superpowers/specs/2026-03-24-player-profile-design.md`

**Stitch designs:** `stitch-designs/player-profile-maya-sterling/` (shooter), `stitch-designs/player-profile-sarah-jenkins/` (defender), `stitch-designs/player-profile-elena-rodriguez/` (mid-court), `stitch-designs/player-profile-keisha-williams/` (playmaker)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma` | Add 6 new fields to Player model |
| Modify | `src/types/the-sports-db.ts` | Add `strHeight`, `strBirthLocation` to TSDBPlayer |
| Modify | `prisma/seed.ts` | Store new bio fields during player upsert |
| Modify | `src/lib/format.ts` | Add `computeAge()` utility |
| Create | `src/lib/format.test.ts` | Tests for `computeAge()` |
| Create | `src/components/player/position-config.ts` | Position → template variant mapping |
| Create | `src/components/player/position-config.test.ts` | Tests for position config |
| Create | `src/components/player/PlayerHero.tsx` | Dark hero with name, photo, bio info, stat highlights |
| Create | `src/components/player/PlayerBioCard.tsx` | Biography text card |
| Create | `src/components/player/PlayerSeasonStats.tsx` | Totals + averages with progress bars |
| Create | `src/components/player/PlayerCharts.tsx` | Bar chart, donut chart (CSS/SVG) |
| Create | `src/components/player/PlayerGameLog.tsx` | Match-by-match table, position-aware columns |
| Create | `src/app/player/[playerId]/page.tsx` | Server component: data fetching, layout, metadata |
| Create | `src/app/player/[playerId]/loading.tsx` | Skeleton loading state |
| Modify | `src/app/team/[teamSlug]/page.tsx` | Make roster rows clickable links |

## Dependency Graph

```
Task 1 (schema + migration)
  ├── Task 2 (types + seed) ── depends on Task 1
  │     └── Task 8 (re-seed) ── depends on Task 2
  ├── Task 3 (format utils) ── independent
  └── Task 4 (position config) ── independent

Task 3, 4 can run in PARALLEL with Task 1

Task 5 (PlayerHero) ── depends on Task 3, 4
Task 6 (PlayerBioCard) ── independent after Task 4
Task 7 (PlayerSeasonStats + PlayerCharts) ── depends on Task 4
Task 9 (PlayerGameLog) ── depends on Task 4

Tasks 5, 6, 7, 9 can run in PARALLEL after their deps

Task 10 (page.tsx + loading.tsx + metadata) ── depends on Tasks 5-9
Task 11 (team page links) ── depends on Task 1 (just needs player IDs)
Task 12 (build verification) ── depends on all
```

---

### Task 1: Expand Prisma Player Model

**Files:**
- Modify: `prisma/schema.prisma:79-88`

**Dependencies:** None (start immediately)

- [ ] **Step 1: Add new fields to Player model**

In `prisma/schema.prisma`, replace the Player model (lines 79-88) with:

```prisma
model Player {
  id                   String             @id @default(cuid())
  name                 String
  position             Position
  photoUrl             String?
  championDataPlayerId Int?               @unique
  teamId               String
  team                 Team               @relation(fields: [teamId], references: [id])
  matchStats           PlayerMatchStats[]

  // Bio fields from TheSportsDB
  nationality          String?
  dateOfBirth          DateTime?
  height               String?            // Imperial format e.g. "6 ft 1 in"
  birthLocation        String?
  biography            String?            @db.Text
  theSportsDbId        String?            @unique
}
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add-player-bio-fields
```

Expected: Migration creates 6 new nullable columns on the Player table.

- [ ] **Step 3: Verify Prisma client regenerated**

Run:
```bash
npx prisma generate
```

Expected: `@prisma/client` updated with new Player fields.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add player bio fields to Prisma schema"
```

---

### Task 2: Update TSDBPlayer Type + Seed Logic

**Files:**
- Modify: `src/types/the-sports-db.ts:28-39`
- Modify: `prisma/seed.ts:166-179`

**Dependencies:** Task 1 (migration must exist for new fields)

- [ ] **Step 1: Add new fields to TSDBPlayer interface**

In `src/types/the-sports-db.ts`, replace the `TSDBPlayer` interface (lines 28-39) with:

```typescript
export interface TSDBPlayer {
  idPlayer: string;
  strPlayer: string;
  strPosition: string;
  strNationality: string;
  strThumb: string | null;
  strCutout: string | null;
  strRender: string | null;
  dateBorn: string | null;
  strDescriptionEN: string | null;
  strTeam: string;
  strHeight: string | null;
  strBirthLocation: string | null;
}
```

Note: Also change `strThumb`, `strCutout`, `strRender`, `dateBorn`, `strDescriptionEN` from `string` to `string | null` to match API reality.

- [ ] **Step 2: Update seed player upsert to store new fields**

In `prisma/seed.ts`, replace the player create block (lines 172-179) with:

```typescript
await prisma.player.create({
  data: {
    name: p.strPlayer,
    position,
    photoUrl,
    teamId: prismaTeamId,
    nationality: p.strNationality || null,
    dateOfBirth: p.dateBorn ? new Date(p.dateBorn) : null,
    height: p.strHeight || null,
    birthLocation: p.strBirthLocation || null,
    biography: p.strDescriptionEN || null,
    theSportsDbId: p.idPlayer,
  },
});
```

**Note:** Players created from Champion Data match stats (the `else` branch in seed Step 6.5) will NOT have bio fields populated — only TSDB-sourced players get bio data. The player profile page handles null bio fields gracefully.

- [ ] **Step 3: Commit**

```bash
git add src/types/the-sports-db.ts prisma/seed.ts
git commit -m "feat: store player bio fields from TheSportsDB in seed"
```

---

### Task 3: Add `computeAge` Utility + Tests

**Files:**
- Modify: `src/lib/format.ts`
- Create: `src/lib/format.test.ts`

**Dependencies:** None (can run in parallel with Task 1)

- [ ] **Step 1: Write the failing test**

Create `src/lib/format.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeAge } from './format';

describe('computeAge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes age correctly for a known date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24'));
    expect(computeAge(new Date('1997-08-26'))).toBe(28);
  });

  it('returns age before birthday this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24'));
    expect(computeAge(new Date('1997-12-15'))).toBe(28);
  });

  it('returns age on birthday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26'));
    expect(computeAge(new Date('1997-08-26'))).toBe(29);
  });

  it('handles leap year birthdays', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01'));
    expect(computeAge(new Date('2000-02-29'))).toBe(26);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `computeAge` is not exported from `./format`

- [ ] **Step 3: Implement `computeAge`**

Add to `src/lib/format.ts`:

```typescript
export function computeAge(dateOfBirth: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = today.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())) {
    age--;
  }
  return age;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/format.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add computeAge utility with tests"
```

---

### Task 4: Create Position Config

**Files:**
- Create: `src/components/player/position-config.ts`
- Create: `src/components/player/position-config.test.ts`

**Dependencies:** None (can run in parallel with Tasks 1-3)

- [ ] **Step 1: Write the failing test**

Create `src/components/player/position-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getPositionConfig, type PositionGroup } from './position-config';

describe('getPositionConfig', () => {
  it('maps GS to shooter group', () => {
    const config = getPositionConfig('GS');
    expect(config.group).toBe('shooter');
  });

  it('maps GA to shooter group', () => {
    const config = getPositionConfig('GA');
    expect(config.group).toBe('shooter');
  });

  it('maps GK to defender group', () => {
    const config = getPositionConfig('GK');
    expect(config.group).toBe('defender');
  });

  it('maps GD to defender group', () => {
    const config = getPositionConfig('GD');
    expect(config.group).toBe('defender');
  });

  it('maps C to midcourt group', () => {
    const config = getPositionConfig('C');
    expect(config.group).toBe('midcourt');
  });

  it('maps WA to midcourt group', () => {
    const config = getPositionConfig('WA');
    expect(config.group).toBe('midcourt');
  });

  it('maps WD to midcourt group', () => {
    const config = getPositionConfig('WD');
    expect(config.group).toBe('midcourt');
  });

  it('shooter highlights include goals, shooting %, rebounds', () => {
    const config = getPositionConfig('GS');
    const keys = config.highlights.map(h => h.key);
    expect(keys).toContain('goals');
    expect(keys).toContain('shootingPct');
    expect(keys).toContain('rebounds');
  });

  it('defender highlights include intercepts, rebounds, deflections', () => {
    const config = getPositionConfig('GK');
    const keys = config.highlights.map(h => h.key);
    expect(keys).toContain('intercepts');
    expect(keys).toContain('rebounds');
    expect(keys).toContain('deflections');
  });

  it('midcourt highlights include goalAssists, feeds, centrePassReceives', () => {
    const config = getPositionConfig('C');
    const keys = config.highlights.map(h => h.key);
    expect(keys).toContain('goalAssists');
    expect(keys).toContain('feeds');
    expect(keys).toContain('centrePassReceives');
  });

  it('all positions have gameLogColumns defined', () => {
    const positions = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'] as const;
    for (const pos of positions) {
      expect(getPositionConfig(pos).gameLogColumns.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/player/position-config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement position config**

Create `src/components/player/position-config.ts`:

```typescript
import type { Position } from '@prisma/client';

export type PositionGroup = 'shooter' | 'defender' | 'midcourt';

export interface StatHighlight {
  key: string;
  label: string;
  /** Field name on PlayerMatchStats, or 'shootingPct' for computed */
  statField: string;
  format?: 'percentage' | 'number';
}

export interface GameLogColumn {
  key: string;
  label: string;
  abbrev: string;
  statField: string;
  format?: 'percentage' | 'number';
}

export interface PositionConfig {
  group: PositionGroup;
  highlights: StatHighlight[];
  gameLogColumns: GameLogColumn[];
  /** Field used for the main bar chart */
  primaryChartStat: string;
  primaryChartLabel: string;
}

const COMMON_COLUMNS: GameLogColumn[] = [
  { key: 'date', label: 'Date', abbrev: 'Date', statField: '_date' },
  { key: 'opponent', label: 'Opponent', abbrev: 'Opp', statField: '_opponent' },
  { key: 'result', label: 'Result', abbrev: 'Result', statField: '_result' },
];

const SHOOTER_CONFIG: PositionConfig = {
  group: 'shooter',
  highlights: [
    { key: 'goals', label: 'Goals Scored', statField: 'goals' },
    { key: 'shootingPct', label: 'Shooting %', statField: 'shootingPct', format: 'percentage' },
    { key: 'rebounds', label: 'Rebounds', statField: 'rebounds' },
  ],
  gameLogColumns: [
    ...COMMON_COLUMNS,
    { key: 'goals', label: 'Goals', abbrev: 'G', statField: 'goals' },
    { key: 'attempts', label: 'Attempts', abbrev: 'Att', statField: 'attempts' },
    { key: 'accuracy', label: 'Accuracy', abbrev: 'Acc%', statField: 'shootingPct', format: 'percentage' },
    { key: 'rebounds', label: 'Rebounds', abbrev: 'Reb', statField: 'rebounds' },
    { key: 'feeds', label: 'Feeds', abbrev: 'Fds', statField: 'feeds' },
  ],
  primaryChartStat: 'goals',
  primaryChartLabel: 'Goals',
};

const DEFENDER_CONFIG: PositionConfig = {
  group: 'defender',
  highlights: [
    { key: 'intercepts', label: 'Intercepts', statField: 'intercepts' },
    { key: 'rebounds', label: 'Rebounds', statField: 'rebounds' },
    { key: 'deflections', label: 'Deflections', statField: 'deflections' },
  ],
  gameLogColumns: [
    ...COMMON_COLUMNS,
    { key: 'intercepts', label: 'Intercepts', abbrev: 'Int', statField: 'intercepts' },
    { key: 'deflections', label: 'Deflections', abbrev: 'Def', statField: 'deflections' },
    { key: 'rebounds', label: 'Rebounds', abbrev: 'Reb', statField: 'rebounds' },
    { key: 'penalties', label: 'Penalties', abbrev: 'Pen', statField: 'penalties' },
    { key: 'turnovers', label: 'Turnovers', abbrev: 'TO', statField: 'turnovers' },
  ],
  primaryChartStat: 'intercepts',
  primaryChartLabel: 'Intercepts',
};

const MIDCOURT_CONFIG: PositionConfig = {
  group: 'midcourt',
  highlights: [
    { key: 'goalAssists', label: 'Goal Assists', statField: 'goalAssists' },
    { key: 'feeds', label: 'Feeds', statField: 'feeds' },
    { key: 'centrePassReceives', label: 'Centre Pass Receives', statField: 'centrePassReceives' },
  ],
  gameLogColumns: [
    ...COMMON_COLUMNS,
    { key: 'goalAssists', label: 'Goal Assists', abbrev: 'GA', statField: 'goalAssists' },
    { key: 'feeds', label: 'Feeds', abbrev: 'Fds', statField: 'feeds' },
    { key: 'cpr', label: 'Centre Pass Receives', abbrev: 'CPR', statField: 'centrePassReceives' },
    { key: 'intercepts', label: 'Intercepts', abbrev: 'Int', statField: 'intercepts' },
    { key: 'turnovers', label: 'Turnovers', abbrev: 'TO', statField: 'turnovers' },
  ],
  primaryChartStat: 'goalAssists',
  primaryChartLabel: 'Goal Assists',
};

const POSITION_MAP: Record<Position, PositionConfig> = {
  GS: SHOOTER_CONFIG,
  GA: SHOOTER_CONFIG,
  WA: MIDCOURT_CONFIG,
  C: MIDCOURT_CONFIG,
  WD: MIDCOURT_CONFIG,
  GD: DEFENDER_CONFIG,
  GK: DEFENDER_CONFIG,
};

export function getPositionConfig(position: Position): PositionConfig {
  return POSITION_MAP[position];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/player/position-config.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/player/position-config.ts src/components/player/position-config.test.ts
git commit -m "feat: add position config mapping for player profiles"
```

---

### Task 5: Build PlayerHero Component

**Files:**
- Create: `src/components/player/PlayerHero.tsx`

**Dependencies:** Task 3 (computeAge), Task 4 (position config)

**Visual reference:** Hero sections from all 4 Stitch designs — dark gradient, large italic name, position badge, bio info line, stat highlights.

- [ ] **Step 1: Create PlayerHero component**

Create `src/components/player/PlayerHero.tsx`. The component should:

- Accept player data (name, position, photoUrl, nationality, dateOfBirth, height, team name, team slug) and position config
- Render a `kinetic-gradient` hero section matching the team page hero style
- Display large italic player name using Lexend font (reference: `stitch-designs/player-profile-maya-sterling/index.html` line 126)
- Position badge (green pill) with position abbreviation
- Bio info line: nationality, age (via `computeAge`), height (only if available), team name
- Player photo with letter fallback (same pattern as team page roster)
- Back link to team page: `← {Team Name}`
- Stat highlight cards showing the 3 highlights from position config (values passed as props, computed by parent)

Key styling from Stitch designs:
- `font-headline text-6xl md:text-8xl font-black tracking-tighter` for name
- Lime-400 accents for position and stats
- `min-h-[500px]` hero area

- [ ] **Step 2: Verify it renders without errors**

Import it in a temp test or check via `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add src/components/player/PlayerHero.tsx
git commit -m "feat: add PlayerHero component with position-aware stat highlights"
```

---

### Task 6: Build PlayerBioCard Component

**Files:**
- Create: `src/components/player/PlayerBioCard.tsx`

**Dependencies:** None (can start immediately — does not use position config)

- [ ] **Step 1: Create PlayerBioCard component**

Create `src/components/player/PlayerBioCard.tsx`. The component should:

- Accept `biography: string | null`
- Return `null` when biography is null/empty (spec: "Only rendered when biography exists")
- Render a card with `bg-surface-container-lowest rounded-2xl p-8 shadow-sm`
- Section title: "About" using `font-headline text-2xl font-black text-primary uppercase tracking-tight`
- Biography text with `font-body text-on-surface-variant leading-relaxed`
- Truncate long bios with "Read more" toggle (client component with `useState`)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/player/PlayerBioCard.tsx
git commit -m "feat: add PlayerBioCard component with read-more toggle"
```

---

### Task 7: Build PlayerSeasonStats + PlayerCharts Components

**Files:**
- Create: `src/components/player/PlayerSeasonStats.tsx`
- Create: `src/components/player/PlayerCharts.tsx`

**Dependencies:** Task 4 (position config)

**Visual reference:** `stitch-designs/player-profile-maya-sterling/` (stat cards with progress bars, career evolution bar chart)

- [ ] **Step 1: Create PlayerSeasonStats component**

Create `src/components/player/PlayerSeasonStats.tsx`. The component should:

- Accept match stats array and position config
- Compute season totals and per-game averages from the array
- Handle 0 matches: render "No match data available yet" empty state
- Display 3 position-specific stat highlight cards in a grid:
  - Each card: big number (Lexend font-black text-5xl), label, progress bar
  - Progress bar width = value / season max * 100
  - `shootingPct` computed as `(totalGoals / totalAttempts) * 100` (handle 0 attempts)
  - **Performance trend indicator** on each card: up/down arrow + percentage change (most recent match vs prior). Formula: `((current - previous) / previous) * 100`. When previous = 0: show "+N" absolute. When only 1 match: omit trend. Colors: lime-400 (positive), error (negative). See Stitch reference: `stitch-designs/player-profile-sarah-jenkins/index.html` lines 165-168 for `+12%` styling.
- Below highlights: "Season Averages" section showing all stats as a compact grid
- Styling from Stitch: `border-l-4 border-secondary` on stat cards, `bg-surface-container-lowest rounded-2xl p-8`

- [ ] **Step 2: Create PlayerCharts component**

Create `src/components/player/PlayerCharts.tsx`. The component should:

- Accept match stats array and position config
- **Bar chart (all positions):** One bar per match for the `primaryChartStat`. Bars are `div` elements, height proportional to max value. Lime-400 gradient fill. Match date labels below. Container: `bg-primary-container rounded-2xl p-8 text-white` (matches Stitch career evolution style)
- **Donut chart (shooters only):** CSS `conic-gradient` showing goal accuracy. Center text shows percentage. Only render when `config.group === 'shooter'`
- **Defensive actions stacked bar (defenders only):** Show intercepts + deflections + rebounds per match as stacked bars with distinct colors (secondary, lime-400, outline-variant). Only render when `config.group === 'defender'`
- **Feed distribution bar (mid-court only):** Show goalAssists vs feeds per match as grouped bars. Two bars per match — goalAssists (secondary) and feeds (lime-400). Only render when `config.group === 'midcourt'`
- **Performance Trend Indicator (all positions):** On each stat highlight card in `PlayerSeasonStats`, show an up/down arrow + percentage change comparing the most recent match to the prior match. Formula: `((current - previous) / previous) * 100`. Edge cases: when previous = 0, show "+N" absolute change instead of percentage. When only 1 match exists, omit the trend indicator entirely. Arrow color: lime-400 for positive, error red for negative.
- Handle 0 matches: return null

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/player/PlayerSeasonStats.tsx src/components/player/PlayerCharts.tsx
git commit -m "feat: add PlayerSeasonStats and PlayerCharts components"
```

---

### Task 8: Re-seed Database with Bio Fields

**Files:** None (runs seed command)

**Dependencies:** Task 2 (seed changes must be committed)

- [ ] **Step 1: Reset and re-seed**

Run:
```bash
npx prisma migrate reset --force
```

This drops the DB, re-applies all migrations, and runs the seed. The `--force` flag skips confirmation.

- [ ] **Step 2: Verify bio data was stored**

Run:
```bash
npx prisma studio
```

Open in browser, check the Player table. Verify:
- `nationality` populated for all players
- `dateOfBirth` populated for all players
- `biography` populated for all players
- `height` populated for ~41% of players
- `birthLocation` populated for ~39% of players
- `theSportsDbId` populated for all players

- [ ] **Step 3: No commit needed** (database state only)

---

### Task 9: Build PlayerGameLog Component

**Files:**
- Create: `src/components/player/PlayerGameLog.tsx`

**Dependencies:** Task 4 (position config)

**Visual reference:** `stitch-designs/player-profile-maya-sterling/index.html` lines 213-300 (game log table)

- [ ] **Step 1: Create PlayerGameLog component**

Create `src/components/player/PlayerGameLog.tsx`. The component should:

- Accept match stats (with nested match + teams) and position config
- Handle 0 matches: render "No match data available yet"
- Render a table with position-specific columns from `config.gameLogColumns`
- For each match stat row:
  - Date: `formatShortDate(match.scheduledAt)` from `src/lib/format.ts`
  - Opponent: TeamBadge (small, 24px) + opponent name. Determine opponent from `match.homeTeam`/`match.awayTeam` based on which team the player belongs to
  - Result: W/L badge with score. Green bg for win, red for loss. Format: `W 62-58` or `L 54-55`
  - Stat columns: Read from the match stat record using `statField` from config
  - `shootingPct` column: compute `(goals / attempts * 100).toFixed(0) + '%'` per row
- Each row links to `/match/{match.id}`
- Mobile: `overflow-x-auto` wrapper for horizontal scroll
- Styling: match Stitch table — `text-[10px] uppercase tracking-[0.2em]` headers, hover rows

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/player/PlayerGameLog.tsx
git commit -m "feat: add PlayerGameLog component with position-aware columns"
```

---

### Task 10: Create Player Profile Page + Loading + Metadata

**Files:**
- Create: `src/app/player/[playerId]/page.tsx`
- Create: `src/app/player/[playerId]/loading.tsx`

**Dependencies:** Tasks 5, 6, 7, 9 (all components must exist)

- [ ] **Step 1: Create the page component**

Create `src/app/player/[playerId]/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getPositionConfig } from '@/components/player/position-config';
import { PlayerHero } from '@/components/player/PlayerHero';
import { PlayerBioCard } from '@/components/player/PlayerBioCard';
import { PlayerSeasonStats } from '@/components/player/PlayerSeasonStats';
import { PlayerCharts } from '@/components/player/PlayerCharts';
import { PlayerGameLog } from '@/components/player/PlayerGameLog';
import type { Metadata } from 'next';

interface PlayerPageProps {
  params: Promise<{ playerId: string }>;
}

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { playerId } = await params;
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { team: { select: { name: true } } },
  });

  if (!player) return { title: 'Player Not Found | NETPULSE' };

  return {
    title: `${player.name} | ${player.team.name} | NETPULSE`,
    description: `${player.name} — ${player.position} for ${player.team.name}. Season stats, game log, and profile.`,
  };
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { playerId } = await params;

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      team: true,
      matchStats: {
        include: {
          match: {
            include: {
              homeTeam: true,
              awayTeam: true,
            },
          },
        },
        orderBy: { match: { scheduledAt: 'desc' } },
      },
    },
  });

  if (!player) notFound();

  const config = getPositionConfig(player.position);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <PlayerHero player={player} config={config} />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8">
          <PlayerSeasonStats matchStats={player.matchStats} config={config} />
        </div>
        <div className="md:col-span-4">
          <PlayerCharts matchStats={player.matchStats} config={config} />
        </div>
      </div>

      <PlayerBioCard biography={player.biography} />

      <PlayerGameLog
        matchStats={player.matchStats}
        config={config}
        playerTeamId={player.teamId}
      />
    </div>
  );
}
```

Adjust prop types and layout as needed to match Stitch designs. The above is the structural skeleton — the exact grid proportions should reference the Stitch HTML.

- [ ] **Step 2: Create loading skeleton**

Create `src/app/player/[playerId]/loading.tsx`:

```typescript
export default function PlayerLoading() {
  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-pulse">
      {/* Hero skeleton */}
      <div className="kinetic-gradient rounded-xl min-h-[400px] p-12">
        <div className="flex items-end gap-8">
          <div className="w-32 h-40 bg-white/10 rounded-xl" />
          <div className="flex-1 space-y-4">
            <div className="h-6 w-24 bg-white/10 rounded" />
            <div className="h-16 w-96 bg-white/10 rounded" />
            <div className="h-4 w-64 bg-white/10 rounded" />
          </div>
        </div>
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8 bg-surface-container-lowest rounded-2xl h-64" />
        <div className="md:col-span-4 bg-primary-container rounded-2xl h-64" />
      </div>

      {/* Game log skeleton */}
      <div className="bg-surface-container-lowest rounded-2xl h-80" />
    </div>
  );
}
```

- [ ] **Step 3: Verify page loads**

Start dev server (`npm run dev`), navigate to a player page. Get a player ID from Prisma Studio or the team page.

- [ ] **Step 4: Commit**

```bash
git add src/app/player/
git commit -m "feat: add player profile page with loading skeleton and metadata"
```

---

### Task 11: Make Team Roster Rows Clickable

**Files:**
- Modify: `src/app/team/[teamSlug]/page.tsx:161-191`

**Dependencies:** Task 1 (player IDs in DB, but they already exist)

- [ ] **Step 1: Wrap roster rows in Link**

In `src/app/team/[teamSlug]/page.tsx`, replace the roster `<tr>` (lines 161-191) with a linked version. Change:

```tsx
<tr key={player.id} className="hover:bg-surface-container-low transition-colors">
```

To:

```tsx
<tr key={player.id} className="hover:bg-surface-container-low transition-colors cursor-pointer group">
```

And wrap the entire row content logic — make the `<tr>` an `<Link>` as a table row, or more practically, wrap each `<td>` content. The cleanest approach: wrap the player name cell in a Link and add a chevron column:

Add a third column header after "Pos":
```tsx
<th className="p-4 w-12"></th>
```

Add a third cell in each row:
```tsx
<td className="p-4 text-right">
  <Link href={`/player/${player.id}`} className="text-outline-variant group-hover:text-secondary transition-colors">
    <span className="material-symbols-outlined text-lg">chevron_right</span>
  </Link>
</td>
```

And wrap the player name in a Link too:
```tsx
<Link href={`/player/${player.id}`} className="font-body font-bold text-primary hover:text-secondary transition-colors">
  {player.name}
</Link>
```

- [ ] **Step 2: Verify navigation works**

Navigate to a team page, click a player name → should navigate to `/player/{id}`.

- [ ] **Step 3: Commit**

```bash
git add src/app/team/[teamSlug]/page.tsx
git commit -m "feat: make team roster rows link to player profiles"
```

---

### Task 12: Build Verification + Type Check

**Files:** None (verification only)

**Dependencies:** All previous tasks

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (format tests + position config tests)

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Manual smoke test**

1. Open homepage → click a team → team roster shows clickable players
2. Click a player → player profile page loads
3. Verify hero section shows name, position, bio info
4. Verify stats section shows position-appropriate highlights
5. Verify charts render (bar chart, donut for shooters)
6. Verify game log shows position-specific columns
7. Verify back link returns to team page
8. Test a player with no match stats → shows empty state
9. Test mobile viewport → hero stacks, table scrolls horizontally

- [ ] **Step 5: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "feat: complete player profile page implementation"
```
