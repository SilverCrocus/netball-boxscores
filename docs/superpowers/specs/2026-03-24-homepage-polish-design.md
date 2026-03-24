# Homepage Polish: Team Logos, Date Display, Results Ordering

**Date:** 2026-03-24
**Scope:** `src/app/page.tsx`, `src/components/ui/ScoreCard.tsx`

## Problem

The home page has three UI issues:

1. **No team logos** — Letter placeholders (`M`, `G`, `T`, etc.) are shown instead of actual team badge images, despite `logoUrl` being fetched from the database.
2. **Results not ordered by recency** — Completed matches display oldest-first (Round 1 at top). Users expect most recent results first.
3. **No dates on matches** — Neither results nor upcoming fixtures show the date of the game, only time (fixtures) or round/venue (results).

## Changes

### 1. Team Logos with Letter Fallback

Replace letter-placeholder `<div>` elements with `next/image` `<Image>` components using the team's `logoUrl`. When `logoUrl` is null, fall back to the existing letter-in-colored-box.

**Affected locations:**
- `page.tsx` featured match hero — 80x80 circles (home and away)
- `page.tsx` side fixture cards — 40x40 squares
- `ScoreCard.tsx` — 48x48 squares (home and away)

TheSportsDB domains are already configured in `next.config.ts` `remotePatterns`.

### 2. Results Ordered Most Recent First

Sort completed matches by `scheduledAt` descending so the most recent results appear first.

**Implementation:** Reverse the `completedMatches` array after filtering (since the query already orders ascending for upcoming fixtures).

### 3. Date Display on All Match Cards

Add the game date in `"Sat 22 Mar"` format using `en-AU` locale with `{ weekday: 'short', day: 'numeric', month: 'short' }`.

**ScoreCard footer (results):** Prepend date before the existing "Round X - Venue" text, e.g. `Sat 22 Mar · Round 1 · Nissan Arena`.

**Featured fixture hero:** Add date below the existing time display.

**Side fixture cards:** Add date alongside the existing time display.

## Files Modified

| File | Change |
|------|--------|
| `src/app/page.tsx` | Replace letter placeholders with `<Image>`, add dates to featured + side fixtures, reverse completed matches |
| `src/components/ui/ScoreCard.tsx` | Replace letter placeholders with `<Image>`, add date to footer |
