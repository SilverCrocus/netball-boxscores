# Live Page Redesign — Design Spec

**Date:** 2026-03-28
**Branch:** `live-page`
**Approach:** Enhanced Current Layout (Option A) — same structure, upgraded components

## Overview

Redesign the live match page (`/match/[matchId]/live`) to improve visual quality, information density, and interactivity. The page keeps its existing three-panel layout (hero + lineups/stats + feed sidebar) but every component gets significant upgrades.

## 1. Score Banner (LiveScoreHero)

**Current:** Small live pill with tiny "Q1 · 420" text. No quarter-by-quarter breakdown.

**Redesign:**

- **Large live pill** — green `secondary` background, white pulsing dot, "Q2 · 8:42" in Inter 12px bold uppercase. Replaces the current tiny 10px pill.
- **Score numbers** — stay at 7xl/9xl Lexend black as-is (these are already good).
- **Quarter-by-quarter grid** — new `<table>` below the score center:
  - Header row: blank | Q1 | Q2 | Q3 | Q4 | T
  - Home row: team abbreviation | score per quarter | total
  - Away row: same
  - Active quarter column highlighted with `secondary` tint (`rgba(0,110,10,0.25)`)
  - Total column bold white
  - Unplayed quarters show en-dash in muted color
  - Uses `border-collapse: separate` with 1px spacing for cell gaps
- **Centered layout** — hero content constrained to max-width ~960px, centered. Home team right-aligned toward score, away team left-aligned toward score (mirrored).
- **Background** — unchanged: `kinetic-gradient` (#000613 → #001f3f) with secondary overlay on right half.

**Data source:** Quarter scores come from `match.quarters` (already fetched in page.tsx but not passed to client). Need to serialize and pass `MatchQuarter[]` data, and update via socket when quarters complete.

## 2. Live Lineups (LiveLineups)

**Current:** Flat player list with position-adaptive single stat label per player. No on-court/bench distinction. No player links. No table structure.

**Redesign:**

### Stats Table Format
- Replace the current row-per-player layout with proper `<table>` elements
- Consistent columns for BOTH teams: **Player | G | ATT | AST | INT | FD**
- Column headers have `title` tooltips with name + short description:
  - G: "Goals — Successful shots scored"
  - ATT: "Attempts — Total shots taken"
  - AST: "Goal Assists — Passes to scorer"
  - INT: "Intercepts — Possessions won"
  - FD: "Feeds — Passes into circle"
- Column headers show dotted underline to indicate interactivity
- Goal values for shooters (GS/GA) highlighted in `secondary` color + bold

### Column Sorting
- **Stat columns** (G, ATT, AST, INT, FD): Click cycles descending (▼) → ascending (▲) → default
- **Player column**: Click toggles GK→GS (defense first, shows "GK→GS" label) → back to default GS→GK (no indicator, it's the natural order)
- Only one column sorted at a time — clicking a new column resets the previous
- Sort applies only to on-court players; bench players always pinned at bottom
- Sort state is per-table (home and away sort independently)

### On-Court vs Bench
- **"On Court" group label** with green dot indicator, positioned above the on-court player rows
- **"Bench" group label** below, dimmed (0.5 opacity)
- On-court players: full opacity, position badges in team color
- Bench players: 0.45 opacity on all cells, position badges at 0.35 opacity
- Bench rows have subtle hover that brings opacity to 0.7

### Player Sort Order
- Default: on-court players ordered by position (GS → GK), bench below
- On-court players determined by `minutesPlayed > 0` as proxy (simulation gives 7 on-court players per team)

### Team Column Headers
- Home: team badge mini + team name, green `secondary` accent with 2px bottom border, left-aligned
- Away: team badge mini + team name, navy `primary-container` accent with 2px bottom border, right-aligned
- Columns separated by 1px `outline-variant` vertical border

### Player Links
- All player names are `<Link>` to `/player/[playerId]`
- Style: `on-surface` color, no underline by default
- Hover: `secondary` color with underline
- Works for both on-court and bench players

## 3. Live Feed (LivePlayByPlay)

**Current:** Generic "Goal scored. X - Y" with redundant score line below. No team attribution. No player names.

**Redesign:**

### Rich Scoring Entries
Each feed entry contains:
- **Team mini-badge** (28px circle) — home uses `primary-container` navy background, away uses `secondary` green background. Shows team abbreviation (3 letters).
- **Timestamp** — "3:00 · Q2" in Inter 10px muted, uppercase
- **Description** — player name as hyperlink + "scored" (e.g., "S. Fretwell scored"). Player links to `/player/[playerId]`. Font: Manrope 14px semibold white.
- **Score badge** — inline tag showing running score after the goal (e.g., "9 – 7"). Home goals: navy background with light blue text. Away goals: green background with bright green text.

### Quarter Separators
- Between quarters, insert a separator row: "▶ Quarter 2 Start"
- Styled as centered text, muted color, uppercase, subtle background tint

### Identifying the Scorer
- `scoreFlow` events include `scoringTeamId` — use this to determine which team scored
- To identify the specific player: compare player goal counts between consecutive stat updates. The player whose goals increased is the scorer.
- Fallback: if player can't be identified, show team name + "scored" (e.g., "Lightning scored")

### Feed Container
- Background: `slate-950` (#0f172a) — unchanged
- Header: `slate-800` (#1e293b) with "Live Feed" title + sensors icon + "Real-Time" badge in lime-400
- Scrollable area with max-height, sticky positioning (top-24)
- Auto-scrolls to newest entry when new goals arrive

## 4. Key Match Stats (MatchStatsComparison)

**Current:** 4 stats (Goals, Intercepts, Deflections, Turnovers).

**Redesign:**

- Expand to **6 stats**: Goals, Intercepts, Deflections, Turnovers, Feeds, Goal Assists
- Home bar: `primary-container` (navy), Away bar: `secondary` (green) — unchanged
- Bar height increased slightly (8px vs current 6-8px) with 4px border-radius
- Stat label: Inter 10px uppercase centered
- Values: Inter 13px bold on either side

## 5. Data Flow Changes

### Quarter Scores
- **page.tsx**: Already fetches `quarters: { orderBy: { quarter: 'asc' } }` — need to serialize and pass to `LiveGameClient`
- **LiveGameClient**: Accept quarters prop, display in hero
- **Socket**: No new event needed — quarter scores can update when `score:update` fires (re-fetch or derive from cumulative)

### Player Identification for Feed
- **LiveGameClient**: Track previous player stats. On each `scoreflow:add` event, compare current vs previous player goal counts to identify scorer.
- **Feed entry type**: Extend `PlayByPlayEntry` interface to include `scorerName`, `scorerPlayerId`, `teamId`, `teamAbbreviation`

### Real-time Stats Consumption
- **Current gap**: `useMatchSocket` receives `stats:update` events but `LiveGameClient` never reads them. Fix: merge socket player stats into the rendered lineup data so stats update live.

## 6. Component Changes Summary

| Component | File | Changes |
|-----------|------|---------|
| LiveScoreHero | `src/components/match/LiveScoreHero.tsx` | Add quarter grid table, enlarge live pill, center layout with max-width |
| LiveLineups | `src/components/match/LiveLineups.tsx` | Full rewrite — stats table, on-court/bench, sorting, player links |
| LivePlayByPlay | `src/components/match/LivePlayByPlay.tsx` | Rich entries with team badges, player names/links, score badges, quarter separators |
| MatchStatsComparison | `src/components/match/MatchStatsComparison.tsx` | Add 2 more stats (feeds, goal assists) |
| LiveGameClient | `src/app/match/[matchId]/live/LiveGameClient.tsx` | Pass quarters, consume socket stats, scorer identification logic, enriched feed entries |
| page.tsx | `src/app/match/[matchId]/live/page.tsx` | Serialize quarter data to client |

## 7. What's NOT Changing

- Page URL structure (`/match/[matchId]/live`)
- Overall layout (hero + left content + right feed sidebar)
- Socket.io infrastructure (hooks, server, events)
- Worker/simulation engine
- Dark feed sidebar aesthetic
- `kinetic-gradient` hero background
- TeamBadge component (reused as-is in hero)
- Mobile: no mobile-specific changes in this iteration

## 8. Design Reference

Visual mockup: `.superpowers/brainstorm/92505-1774618225/content/approach-a-themed.html`
