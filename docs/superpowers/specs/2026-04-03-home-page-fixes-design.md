# Home Page UI Fixes — Design Spec

**Date:** 2026-04-03
**Scope:** Home page (`page.tsx`), ScoreCard component, format utilities

## Overview

Seven targeted UI fixes to the CentrePass home page improving labelling, date formatting, information density, and layout consistency.

## Changes

### 1. Rename "Match of the Day" → "Next Match"

The featured match section label changes from "Match of the Day" to "Next Match". This is a single string change in `src/app/page.tsx` (line ~87).

### 2. Combined date/time format

New `formatMatchDateTime(date)` function added to `src/lib/format.ts`.

**Output:** `"Sat 5 Apr, 3:00 pm"` — weekday short, day, month short, comma, time with no leading zero on hour.

Implementation: Compose from existing `Intl.DateTimeFormat` with `en-AU` locale, `Australia/Sydney` timezone. Options: `{ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }`. The `en-AU` locale with `hour: 'numeric'` naturally drops the leading zero and produces 12-hour time with am/pm.

Applied in:
- Featured "Next Match" card — date and time on one line, venue on a separate line below
- Side fixture cards — combined date/time line
- ScoreCard completed status row (replaces "Final" badge on home page)

### 3. Side fixtures: full team names, venues, larger badges

The upcoming match sidebar cards (indices 1–3 after the featured match) change:

- **Team names:** `match.homeTeam.abbreviation` → `match.homeTeam.name` (e.g., "VIX v FEV" → "Vixens v Fever")
- **Badges:** Size 32px → 44px
- **Venue:** New line below date/time showing `match.venue`
- **Date/time:** Uses new `formatMatchDateTime()` format
- **Layout order:** Team names line first (prominent), then date/time, then venue

### 4. Remove "Final" badge from completed results on home page

ScoreCard currently shows a "Final" pill badge for `status === 'COMPLETED'`. On the home page results section, this is redundant since only completed matches appear there.

**Approach:** Add a `showFinalBadge` prop to ScoreCard (default `true` for backwards compatibility). The home page passes `showFinalBadge={false}`. When false and status is COMPLETED, the status row shows the combined date/time (`formatMatchDateTime`) instead of the "Final" pill.

ScoreCard used elsewhere (match detail pages, live scores) is unaffected.

### 5. Game start time in results

Handled by Change 4. The combined date/time in the status row provides the game start time alongside the date. The footer continues to show date, venue (round number removed per Change 6 — the group heading shows it).

### 6. Results grouped by round, descending

The results section changes from a flat grid to grouped sections:

**Grouping logic (in `page.tsx`):**
1. Sort completed matches by `round` descending, then `scheduledAt` ascending within each round
2. Group into a `Map<number, Match[]>` keyed by round number
3. Render each group with a "Round N" heading

**Rendering per group:**
- Heading: "Round N" with `text-sm font-semibold` and a subtle bottom border (`border-b border-outline-variant`)
- Cards: 2-column grid on `md:` (same as current), using ScoreCard
- ScoreCard footer: The home page omits the `round` prop when passing match data to ScoreCard (the prop is already optional). This naturally hides the round from the footer since the group heading already shows it. Footer shows date and venue only, separated by bullet. ScoreCard itself is unchanged — other callers can still pass `round`.

**Sort detail:** Within the same round, matches ordered by `scheduledAt` ascending so the earliest game in the round appears first (left-to-right, top-to-bottom reading order).

### 7. Consistent card heights with flex-stretch

ScoreCard layout becomes a flex column so cards in the same grid row always align their footers:

- Card outer: `flex flex-col h-full`
- Score/team content area: `flex-grow flex flex-col justify-center` — vertically centers content and absorbs height differences from team name wrapping
- Footer: Stays at the bottom naturally since content area grows above it

The parent grid (`grid grid-cols-1 md:grid-cols-2`) already stretches items to equal row height by default — the flex column inside ScoreCard ensures the internal layout responds correctly.

## Files Changed

| File | Changes |
|------|---------|
| `src/lib/format.ts` | Add `formatMatchDateTime()` |
| `src/app/page.tsx` | Rename label, full names in side fixtures, venue in side fixtures, 44px badges, grouped results with round headings, new date/time format |
| `src/components/ui/ScoreCard.tsx` | `showFinalBadge` prop, flex-stretch layout |

## Out of Scope

- No changes to live match cards (they already show quarter/time, not "Final")
- No changes to other pages using ScoreCard
- No pagination on results (separate concern)
- No changes to the hero header section
