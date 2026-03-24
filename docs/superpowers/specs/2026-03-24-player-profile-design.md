# Player Profile Page — Design Spec

## Overview

Add individual player profile pages to NETPULSE. Users click a player from the team roster to see their full bio, season stats (totals + averages), position-specific charts, and match-by-match game log. The page adapts its stat highlights and visualizations based on whether the player is a shooter, defender, or mid-court player.

## Visual Reference

Stitch designs in `stitch-designs/player-profile-*/`:
- `player-profile-maya-sterling/` — Shooter template (GS/GA)
- `player-profile-sarah-jenkins/` — Defender template (GD/GK)
- `player-profile-elena-rodriguez/` — Mid-court template (C)
- `player-profile-keisha-williams/` — Playmaker template (WA/WD)

## Data Model Changes

### Expanded Player Model

Add fields to the existing `Player` model in `prisma/schema.prisma`:

```prisma
model Player {
  // existing fields
  id                    String   @id @default(cuid())
  name                  String
  position              Position
  photoUrl              String?
  championDataPlayerId  Int?
  teamId                String
  team                  Team     @relation(fields: [teamId], references: [id])
  matchStats            PlayerMatchStats[]

  // new fields
  nationality           String?
  dateOfBirth           DateTime?
  height                String?   // imperial format from TheSportsDB e.g. "6 ft 1 in"
  birthLocation         String?
  biography             String?   @db.Text
  theSportsDbId         String?   @unique
}
```

### Data Availability (from TheSportsDB)

| Field | Coverage | Source |
|-------|----------|--------|
| nationality | 100% | `strNationality` |
| dateOfBirth | 100% | `dateBorn` |
| biography | 100% | `strDescriptionEN` |
| height | ~41% | `strHeight` |
| birthLocation | ~39% | `strBirthLocation` |
| theSportsDbId | 100% | `idPlayer` |

Missing fields are rendered as absent — no "N/A" placeholders. The layout adapts gracefully.

## Seed Changes

### Storing Additional Fields

The seed already uses `lookup_all_players.php?id={tsdbTeamId}` which returns the full 60+ field set. Currently only name, position, and photo URL are stored. Update the seed to also persist the new fields.

### New Fields in TSDBPlayer Type

Add to `src/types/the-sports-db.ts`:

```typescript
interface TSDBPlayer {
  // existing fields (unchanged)
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

  // new fields to add
  strHeight: string | null;
  strBirthLocation: string | null;
}
```

### Seed Logic

Update the player upsert to store:
- `nationality` ← `strNationality`
- `dateOfBirth` ← `new Date(dateBorn)` (when not null)
- `height` ← `strHeight`
- `birthLocation` ← `strBirthLocation`
- `biography` ← `strDescriptionEN`
- `theSportsDbId` ← `idPlayer`

No runtime API calls — all data fetched at seed time, consistent with existing team badge pattern.

## Routing

### URL Structure

- **Route:** `/player/[playerId]` — uses database cuid
- **File:** `src/app/player/[playerId]/page.tsx`

### Navigation Flow

1. Team roster rows (`/team/[teamSlug]`) become `<Link>` elements → `/player/{player.id}`
2. Player profile shows breadcrumb: Team Name → Player Name
3. Game log rows link to match detail: `/match/{matchId}`

## Page Structure — Adaptive Template

### Common Elements (all positions)

**Hero Section:**
- Dark `kinetic-gradient` background matching existing team page hero style
- Large italic/bold player name (Lexend font, tracking-tighter)
- Position badge (green pill)
- Bio line: nationality, age (computed from DOB via `computeAge()` utility in `src/lib/format.ts`), height (when available), team name
- Player photo from DB `photoUrl` field (already resolved at seed time: cutout → thumb → render), with letter fallback
- Back link to team page

**Biography Card:**
- Full `strDescriptionEN` text from TheSportsDB
- Only rendered when biography exists

**Season Summary:**
- Both totals and per-game averages
- Computed in-component from the included `matchStats` array (avoids a second DB query)
- Games played count
- When a player has 0 match stats, show an empty state: "No match data available yet" in place of Season Summary, Charts, and Game Log sections

**Game Log Table:**
- Match-by-match stats, most recent first
- Columns vary by position group (see below)
- Each row links to match detail page
- Shows opponent badge, date, W/L result indicator

### Position Groups

**Shooters (GS, GA):**
- Hero stat highlights: Goals Scored, Shooting % (goals/attempts), Rebounds
- Charts: Goal accuracy donut (CSS conic-gradient) + season goals bar chart
- Game log columns: Date, Opponent, Result, Goals, Attempts, Acc%, Rebounds, Feeds

**Defenders (GD, GK):**
- Hero stat highlights: Intercepts, Rebounds, Deflections
- Charts: Defensive actions bar chart + performance trend
- Game log columns: Date, Opponent, Result, Intercepts, Deflections, Rebounds, Penalties, Turnovers

**Mid-court (WA, C, WD):**
- Hero stat highlights: Goal Assists (`goalAssists`), Feeds (`feeds`), Centre Pass Receives (`centrePassReceives`)
- Charts: Goal assists trend bar chart + feed distribution
- Game log columns: Date, Opponent, Result, Goal Assists, Feeds, CPR, Intercepts, Turnovers

## Charts & Visualizations

All built with pure CSS/SVG — no external charting library.

### Bar Chart (all variants)
Per-match key stat across the season. Bars use lime-400 gradient, rendered as `div` elements with calculated heights relative to the max value. Labels show match dates.

### Donut Chart (shooters)
Goal accuracy percentage using CSS `conic-gradient` on a circular div. Shows percentage in the center.

### Stat Progress Bars (all variants)
Horizontal bars under each big stat number showing progress relative to season high or a contextual benchmark. Simple `div` width percentages with Tailwind classes.

### Performance Trend Indicator
Up/down arrow with percentage change vs prior match, shown on stat cards. Formula: `((current - previous) / previous) * 100`. When previous value is 0: show "+N" absolute change instead of percentage. When only 1 match exists: omit the trend indicator.

## Component Architecture

```
src/app/player/[playerId]/page.tsx          — Server component, data fetching
src/components/player/
  PlayerHero.tsx                             — Dark hero with name, photo, bio info
  PlayerBioCard.tsx                          — Biography text card
  PlayerSeasonStats.tsx                      — Totals + averages, position-aware highlights
  PlayerGameLog.tsx                          — Match-by-match table, position-aware columns
  PlayerCharts.tsx                           — Bar chart, donut chart, progress bars
  position-config.ts                         — Maps Position enum → stat highlights, columns, chart config
```

### Position Config

A single config object maps each `Position` to its template variant:

```typescript
const POSITION_CONFIG = {
  GS: { group: 'shooter', highlights: [...], columns: [...] },
  GA: { group: 'shooter', highlights: [...], columns: [...] },
  WA: { group: 'midcourt', highlights: [...], columns: [...] },
  C:  { group: 'midcourt', highlights: [...], columns: [...] },
  WD: { group: 'midcourt', highlights: [...], columns: [...] },
  GD: { group: 'defender', highlights: [...], columns: [...] },
  GK: { group: 'defender', highlights: [...], columns: [...] },
};
```

The page component reads position, looks up config, and passes it to child components. No conditional rendering scattered across files.

## Data Fetching

Single Prisma query in the server component:

```typescript
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
          }
        }
      },
      orderBy: { match: { scheduledAt: 'desc' } }
    }
  }
});
```

Season aggregates computed in the component from the included `matchStats` array — avoids a second query.

## Loading & Metadata

### Loading State
Add `src/app/player/[playerId]/loading.tsx` with a skeleton matching the hero + stats layout. Shows shimmer placeholders for the photo, name, stat cards, and game log rows.

### Dynamic Metadata
Export `generateMetadata` from the page to set:
- `title`: "{Player Name} | {Team Name} | NETPULSE"
- `description`: "{Player Name} — {Position} for {Team Name}. Season stats, game log, and profile."

### Age Computation
Add `computeAge(dateOfBirth: Date): number` to `src/lib/format.ts`. Uses UTC dates to avoid timezone edge cases: `Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000))`.

## Mobile Responsiveness

### Game Log Table
On viewports < 768px, the game log table uses horizontal scroll (`overflow-x-auto`). Column headers remain visible. This matches the existing `PlayerStatsTable` pattern used in match box scores.

### Hero Section
On mobile, the hero stacks vertically: photo above, name and bio info below. Quick stat cards wrap into a 2-column grid.

## Team Page Changes

Update roster table in `src/app/team/[teamSlug]/page.tsx`:
- Wrap each player row in `<Link href={/player/${player.id}}>`
- Add hover state and cursor pointer
- Add right chevron icon to indicate clickability
