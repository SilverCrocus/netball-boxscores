# CentrePass — Suncorp Super Netball Scores Website

## Git Policy (project override)

Git commands ARE allowed in this repo (overrides the global "never run git" rule in `~/.claude/CLAUDE.md`). You may commit, push, pull, and perform other git operations when asked.

- Branch naming for fixes uses `hotfix/` or `bugfix/` prefixes only.
- Commit when work is complete and verified (tests passing). Keep commits focused.
- Push to `origin` is permitted. Do not force-push to `main`.
- Still surface anything destructive or irreversible (history rewrites, branch deletion, resets that discard work) before doing it.

Real SSN data displayed under the CentrePass brand at centrepass.io. Live scores, box scores, standings, fixtures, team profiles, player profiles, and on-court visualization.

## Architecture

Next.js 15 Full-Stack Monolith with custom Express server for Socket.io. Deployed on Render (Sydney region).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Prisma 6.x, Supabase PostgreSQL, NextAuth.js, Socket.io, Vitest

## Data Sources

- **Champion Data** (primary): `mc.championdata.com/data/` — free JSON endpoints, no auth. 2026 SSN competition ID: **12949** (configurable via `SSN_COMPETITION_ID` env var).
  - Fixture response structure: `{ fixture: { match: [...] } }` — field names use `roundNumber`, `homeSquadScore`, `venueName`, `matchStatus` (lowercase values)
- **TheSportsDB** (secondary): Team badges, player photos. Use `search_all_teams.php?l=Australian%20Super%20Netball%20League` (NOT `lookup_all_teams.php`).

## Data Seeding

`prisma/seed.ts` fetches real data from both APIs:
- 8 teams from Champion Data with correct squad IDs (801, 804, 806, 807, 810, 8117, 8118, 9698)
- 102 players from TheSportsDB with photos, bios, nationality, DOB, height
- 56 real matches with actual scores
- Standings computed from results

**Name alias mapping** resolves CD→TSDB mismatches: "GIANTS Netball"→"Giants Netball", "NSW Swifts"→"New South Wales Swifts"

Team badges stored in DB `logoUrl` at seed time — pages read from DB, no runtime TheSportsDB calls.

Run `npx prisma db seed` to re-seed with fresh API data.

## Key Documents

- **Design spec:** `docs/superpowers/specs/2026-03-22-netpulse-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-03-23-netpulse-implementation.md` (17 tasks)
- **Player profile spec:** `docs/superpowers/specs/2026-03-24-player-profile-design.md`
- **Player profile plan:** `docs/superpowers/plans/2026-03-24-player-profile-implementation.md` (12 tasks)
- **Live tracking spec:** `docs/superpowers/specs/2026-03-31-live-tracking-completion-design.md`
- **Live tracking plan:** `docs/superpowers/plans/2026-03-31-live-tracking-completion.md`
- **Stitch designs:** `stitch-designs/` (6 original + 4 player profile HTML prototypes)

## Design Reference

UI designs are in `stitch-designs/` — each subfolder contains a `screenshot.png` (visual reference) and `index.html` (prototype code) generated from Google Stitch:

- `box-score-player-stats/` — Detailed player stats and box score layout
- `live-game-center/` — Real-time game tracking with quarter-by-quarter scoring
- `on-court-visualizer/` — Court diagram with player positions
- `fixtures-scores-hub/` — Schedule and results overview
- `league-standings/` — Team rankings table
- `team-profile-vipers/` — Individual team page (example: Vipers Athletics)

- `player-profile-maya-sterling/` — Shooter profile template (GS/GA)
- `player-profile-sarah-jenkins/` — Defender profile template (GD/GK)
- `player-profile-elena-rodriguez/` — Mid-court profile template (C)
- `player-profile-keisha-williams/` — Playmaker profile template (WA/WD)

When building components, reference these designs as the visual spec.

## Design System

- **Colors:** MD3 token set — canonical source is the Tailwind config in any Stitch `index.html`
- **Fonts:** Lexend (headlines), Manrope (body), Inter (labels)
- **Icons:** Material Symbols Outlined
- **Patterns:** `kinetic-gradient` (dark gradient headers), `pulse-live` (live indicator animation)
- **Favicon:** "C" pulse ring icon — `src/app/icon.tsx` (32x32) + `src/app/apple-icon.tsx` (180x180). Generated via `next/og` ImageResponse, same as OG images.

## Shared Components

- **`TeamBadge`** (`src/components/ui/TeamBadge.tsx`): Renders team logo with letter fallback. Use this instead of inline letter placeholders. Props: `team` (name/abbreviation/logoUrl), `size` (px), `variant` ('home'|'away').
- **`ScoreCard`** (`src/components/ui/ScoreCard.tsx`): Match result card with team badges, scores, date, round, and venue. Props: `match` (ScoreCardMatch), `showFinalBadge` (default `true` — when `false`, replaces "Final" pill with `formatMatchDateTime`). Uses flex-stretch layout (`flex flex-col h-full`) for consistent card heights in grids.

## Shared Utilities

- **`src/lib/navigation.ts`**: `NAV_ITEMS` array — single source of truth for sidebar and bottom nav links. Each item has `href`, `label`, `icon`, and optional `sidebarLabel`. Also exports `isActive(pathname, href)` for nav highlight logic.
- **`src/lib/api-auth.ts`**: `requireAuth()` (returns session or 401 response) and `badRequest(msg)` helpers for API routes.
- **`src/lib/format.ts`**: `formatMatchDate(date)`, `formatMatchTime(date)`, `formatMatchDateTime(date)`, `formatShortDate(date)`, `computeAge(dob)` — shared date formatting and age computation. `formatMatchDateTime` combines date + time on one line (e.g., `"Sun, 5 Apr, 3:00 pm"`). All date/time functions pinned to `Australia/Sydney` timezone (not system/UTC).
- **`src/lib/stat-utils.ts`**: Single source of truth for stat field operations. Exports: `STAT_FIELDS` (11 field names), `StatValues` (typed record), `pickStatFields(obj)` (extract stat fields from any object), `emptyStats()` (zero-initialized), `aggregateStats(items)` (sum across players, excludes minutesPlayed), `computeShootingPct(goals, attempts)`, `getStatValue(stat, field)` (dynamic accessor with computed shootingPct).
- **`src/lib/db.ts`**: Prisma client + `excludeSimData` — shared Prisma `where` clause that filters out round-99 simulation data in production. Use this in all match queries instead of inline conditions.
- **`src/lib/user-resource-route.ts`**: `createUserResourceHandlers(config)` — factory for user CRUD API routes (favorites, reminders, teams). Each route file is ~7 lines.
- **`src/types/team.ts`**: `TeamInfo` and `TeamInfoWithId` — shared team type used by ScoreCard, LiveScoreHero, PlayerGameLog, settings page.
- **`src/types/stats.ts`**: `PlayerStatRow` — `{ id, name, position } & StatValues`. Used by box scores, live lineups, player stats tables.
- **`src/types/match.ts`**: `QuarterData` — `{ quarter, homeScore, awayScore }`. Used by LiveScoreHero, QuarterScoreBar, LiveGameClient.
- **`src/types/champion-data.ts`**: Includes `CDRaw*` types (`CDRawMatchStatsResponse`, `CDRawTeamStats`, `CDRawPlayerStats`, `CDRawScoreFlowEntry`) for the raw Champion Data JSON shape. The transform layer in `champion-data.ts` converts `CDRaw*` → normalized types.
- **`src/types/socket.ts`**: Socket.io event payload types — `ScoreUpdatePayload`, `StatsUpdatePayload`, `MatchStatusPayload`, `ScoreFlowAddPayload` (includes `scorePoints`), `StatEventPayload` (intercepts and other notable plays).

## Player Profile Components

`src/components/player/` — position-adaptive template system:
- **`position-config.ts`**: `getPositionConfig(position)` maps Position enum → group (shooter/defender/midcourt), stat highlights, game log columns, chart config. Single source of truth for position-specific rendering.
- **`PlayerHero.tsx`**: Compact kinetic-gradient hero with ghost text watermark (last name, `text-white/[0.03]`). Content-driven height (no min-height). Photo (team-coloured border), white name, position badge, bio line with team logo + team name link (styled with `team.primaryColor`), stat highlight cards with team-coloured left border.
- **`PlayerBioCard.tsx`**: Biography text card with read-more toggle. Only rendered when biography exists.
- **`PlayerSeasonStats.tsx`**: Totals + per-game averages with trend indicators. Position-aware stat highlights. Includes Super Shots per game (derived from ScoreFlow) and Impact rating per game (`goals + goalAssists + intercepts + deflections + rebounds - turnovers - penalties`). Season selector links shown when multiple competitions exist (`?season=` query param).
- **`PlayerCharts.tsx`**: CSS/SVG charts — donut (shooters), stacked bar (defenders), feed distribution (midcourt). No external charting library.
- **`PlayerGameLog.tsx`**: Match-by-match stats table with position-specific columns, opponent badges, W/L indicators.

Team roster rows (`/team/[teamSlug]`) link to `/player/[playerId]`.

## Live Match Components

`src/components/match/` — live game page components:
- **`LiveScoreHero.tsx`**: Score display with team badges, quarter grid, game clock. Shows goals/super shots breakdown `(15.2)` when super shots exist. Detects half-time, full-time, and extra time states.
- **`ScoreProgressChart.tsx`**: SVG step-line graph showing both teams' score progression over match time. Quarter dividers, Y-axis grid, team-colored lines. No external charting library.
- **`LiveLineups.tsx`**: Side-by-side on-court/bench tables with sortable stat columns (G, ATT, AST, INT, FD). Shows per-player super shots as amber `(N)` in goals column. Detects current on-court player via `minutesPlayed` heuristic when multiple players share a position. Bench players render at full opacity (subheading is sufficient context).
- **`LivePlayByPlay.tsx`**: Reverse-chronological feed of scoring events and stat events. `FeedEntry` supports `eventType: 'goal' | 'intercept' | 'deflection' | 'rebound' | 'turnover'`. Goals show scorer links, super shot badges, and running scores. Stat events show player links with distinct colours (intercept: cyan, deflection: violet, rebound: orange, turnover: red) and icons.
- **`MatchPlayByPlay.tsx`**: Static play-by-play feed for completed matches. Shows scoring events and stat events (from `MatchEvent` table) with player avatars (+ team badge overlay), player links, super shot badges, running scores, and quarter separators. Rows tinted with team `primaryColor` at 5% opacity + 3px left border accent at full saturation. Toggle button switches between newest-first and chronological order.
- **`MatchStatsComparison.tsx`**: Horizontal bar chart for team-level stat comparison (Goals, Goal%, Intercepts, Deflections, Turnovers, Feeds, Goal Assists, Centre Pass Receives).

## Match Results Page Tabs

The completed match page (`/match/[matchId]`) uses a client-side tab bar (`MatchTabs.tsx`) to toggle between "Box Score" and "Play by Play" views. The tab bar only renders when score flow data exists. Both views are server-rendered and passed as props — the client component only manages which is visible.

## Live Tracking Pipeline

Three-phase pipeline: **Ingest** (fetch CD API + store PollLog) → **Process** (validate + transform + write DB) → **Broadcast** (socket events, delta-only score flow). Worker polls every 10s (live), 1min (pre-match), 2min (match day), 1hr (off-season).

**Pipeline modules:**
- **`ingestion.ts`**: `ingestFromChampionData(competitionId)` — fetches fixture + match details from Champion Data, stores raw JSON in `PollLog` for audit trail, handles 7-day PollLog cleanup and SCHEDULED→complete backfill detection.
- **`processing.ts`**: `validateMatchData()` (team/player/time validation with clamping), `detectChanges()` (compares incoming vs DB), `applyChanges()` (writes match state to DB with server-side scorer attribution), `reconcileCompletedMatches()`, `detectStaleCompletedMatches()`. Types: `ProcessedMatchState`, `ValidationResult`, `ChangeResult`.
- **`broadcasting.ts`**: `broadcastMatchChanges()` (orchestrator for score/status/stats/flow events), `broadcastScoreFlowDelta()` (delta-only via in-memory count tracker), `broadcastPlayerStats()`, `persistAndBroadcastStatEvents()` (writes intercepts/deflections/rebounds/turnovers to `MatchEvent` table + broadcasts via socket), `broadcastCompletion()`.
- **`worker.ts`**: Slim orchestrator (~170 lines) wiring ingestion → processing → broadcasting with `getLiveState()` for polling interval selection and `recordPoll()`/`setCurrentInterval()` for health tracking.
- **`live-state.ts`**: `getLiveState()` — single source of truth for live detection. Returns `{ liveMatchIds, imminentMatchIds, nextMatchAt, isMatchDay }`. Replaces 5 scattered live-detection implementations.
- **`worker-health.ts`**: Module-level health state (no DB writes). `recordPoll()`, `setCurrentInterval()`, `getWorkerHealth()`. Exposed via `/api/worker-health`.
- **`transformRawCDMatchStats()`** (`champion-data.ts`): Transforms raw CD JSON → normalized types. Entry point for the CD transform pipeline.

**PollLog audit table:** Stores raw API responses with status tracking (success/fetch_error/validation_error/processed) and processing time. 7-day retention with automatic cleanup.

**Super shots:** CD score flow entries have `scorepoints` (1=normal, 2=super shot). Stored as `ScoreFlow.scorePoints` in DB. Broadcast in `scoreflow:add` socket payload. Client shows breakdown `(goals.superShots)` in LiveScoreHero and "Super" badge in the feed. `PlayerStatsTable` shows per-player super shots as amber `(N)` after goals in the "G (SS)" column — derived from ScoreFlow on the match page. Player profile shows super shots per game in season averages.

**Player season filtering:** The player page accepts `?season=YYYY` query param to filter stats by competition. Defaults to the most recent competition. Season selector links render when multiple competitions exist in the DB. The `Competition` model has `id`, `season` (Int), and `name`.

**Scorer attribution:** Champion Data score flow entries don't include who scored — only which team. The worker infers scorers by diffing player goal counts between polls and matching them to new score flow entries. `ScoreFlow.scorerPlayerId` (nullable FK to Player) persists this in the DB. The client uses server-provided scorer info first, falling back to a client-side goal-diff heuristic for unattributed entries.

**Stat events (MatchEvent table):** Persists intercepts, deflections, rebounds, and turnovers with `matchId`, `playerId`, `type`, `period`, `periodSeconds`, `teamId`. Written by the worker on each poll via `persistAndBroadcastStatEvents()`. Live page loads from DB on render + merges new socket events. Completed match play-by-play includes these alongside goals. Unique constraint on `[matchId, playerId, type, period, periodSeconds]`.

**Socket events:** `score:update`, `match:status`, `stats:update`, `scoreflow:add`, `stat:event`. The `stat:event` carries stat events (intercepts, deflections, rebounds, turnovers) with player/team info for the live feed.

**Live quarter derivation:** Quarter breakdowns on the live page are derived from score flow data (not SSR snapshot), so they update in real-time as goals arrive without page refresh.

**Socket lifecycle:** Client (`useMatchSocket.ts`) disconnects 2 seconds after receiving `match:status: COMPLETED` — the delay allows final stat updates to arrive.

## Live Game Simulation

Dev-only system for testing the live scores pipeline without a real Champion Data match. Located in `src/lib/simulation/`.

**How it works:** Admin panel at `/admin/sim` creates temporary Match records (round 99, championDataMatchId 99001+), then the sim engine generates Champion Data-formatted JSON. The existing worker polls these sim endpoints (instead of real CD), validates and writes to DB via the processing module, and broadcasts via Socket.io — exercising the full production pipeline.

**Key files:**
- `src/lib/simulation/engine.ts` — State machine, tick logic, DB setup/teardown, orphan cleanup
- `src/lib/simulation/data-generator.ts` — Builds fake CD JSON responses from sim state
- `src/lib/simulation/sim-routes.ts` — Express routes for sim control + data serving
- `src/app/admin/sim/` — Admin panel UI (SimPanel.tsx)

**Usage:** Set `SIMULATION_MODE=true` in `.env`, run `npm run dev`, open `/admin/sim`.

**Production safeguards (triple-layered):**
1. `server.ts` — Sim routes only mount when `SIMULATION_MODE=true` AND `NODE_ENV !== 'production'`
2. `engine.ts` — `setupSimMatches()` throws if `NODE_ENV === 'production'`
3. `champion-data.ts` — `SIM_MODE` is forced `false` in production, worker always hits real CD API

**Orphan cleanup:** On dev startup, `cleanupOrphanedSimData()` deletes any `round = 99` matches and their children (ScoreFlow, PlayerMatchStats, MatchQuarter). Also available as standalone script: `npx tsx scripts/cleanup-sim-data.ts`.

**Cleanup script:** `scripts/cleanup-sim-data.ts` — Finds and deletes simulation matches (round 99) and all child records. Safe to run against any environment.

## Gotchas

- **Prisma 7 breaks builds:** Always use Prisma 6.x. Import from `@prisma/client`.
- **Champion Data field names:** API uses `roundNumber` not `round`, `homeSquadScore` not `homeScore`, `matchStatus` values are lowercase ("complete" not "Complete")
- **TheSportsDB endpoint:** Must use `search_all_teams.php?l=` not `lookup_all_teams.php?id=` — the latter returns English football teams
- **Next.js 15 async params:** Page params are `Promise<{ param: string }>` — must `await params`
- **Supabase direct connection:** Use pooler session mode (port 5432) as `DIRECT_URL`, not `db.xxx.supabase.co`
- **Match sorting:** Queries use `scheduledAt: 'asc'`. For completed matches (results), reverse to show most-recent-first. For upcoming fixtures filtered from a desc-sorted list, reverse to show nearest-first.
- **Prisma nullable narrowing:** After `if (!match) return notFound()`, use `NonNullable<typeof match>` in function parameter types — TypeScript doesn't narrow through hoisted function declarations.
- **Prisma AI safety check:** `prisma migrate reset` and destructive commands require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes"` env var when run from an AI agent. Use `npx prisma db push --force-reset` as an alternative.
- **Server timezone:** Render servers run in UTC. All date formatting in `format.ts` is pinned to `Australia/Sydney` — do not use bare `toLocaleDateString()`/`toLocaleTimeString()` without `timeZone` option.
- **Simulation data leak:** Simulation writes to the real database via the worker pipeline. If `SIMULATION_MODE=true` reaches production (or dev points at prod DB), sim data pollutes real data. The triple safeguard (server.ts + engine.ts + champion-data.ts) prevents this, but never deploy with `SIMULATION_MODE=true`.
- **Worker fetch caching:** The worker runs in the same Node process as Next.js, so `fetch()` calls are patched and cached by Next.js. Worker fetches must use `cache: 'no-store'` — never `next: { revalidate }` — otherwise the worker gets stale Champion Data responses and detects no changes.
- **Stat fields — never enumerate manually:** Use `STAT_FIELDS`, `pickStatFields()`, `emptyStats()`, `aggregateStats()`, or `extends StatValues` from `stat-utils.ts`. Never list the 11 stat fields inline — this was the #1 duplication source before the refactor.
- **Shooting percentage — use `computeShootingPct()`:** Never inline `(goals / attempts) * 100`. Always import from `stat-utils.ts`.
- **Sim data filter — use `excludeSimData`:** Import from `@/lib/db`. Never write inline `{ round: { not: 99 } }` conditions.
- **Test mocks for `@/lib/db`:** Any test that mocks `@/lib/db` must include `excludeSimData: {}` in the mock, not just `prisma`.
- **`aggregateStats()` excludes `minutesPlayed`:** Minutes played is per-player, not summable. The function deliberately skips it.
- **Champion Data raw field names differ:** Raw CD uses `goalAttempts` not `attempts`, `generalPlayTurnovers` not `turnovers`. The `transformRawCDMatchStats()` layer handles the rename — don't access raw CD fields directly.
- **Client-side API fetch caching:** Client-side `fetch()` to Next.js API routes must use `cache: 'no-store'` in production. Even with `dynamic = 'force-dynamic'` on the route, browsers or intermediate layers may cache GET responses. The `useLiveStatus` hook was broken on Render because of this.
- **Position-only changes need broadcast:** Worker must broadcast `stats:update` even when score/status/time didn't change, otherwise substitution swaps don't reach the client. `broadcastPlayerStats()` in `broadcasting.ts` handles this case.
- **Match completion fallback:** CD may stop sending data without marking "complete". `detectStaleCompletedMatches()` in `processing.ts` catches this: Q4+ clock at end + 90min since `scheduledAt` → auto-COMPLETED. The UI shows exactly what the server provides (no client-side clock interpolation).
- **`useMatchSocket` mock must include `statEvents`:** Tests mocking `useMatchSocket` need `statEvents: []` in the return value, alongside `scoreFlow: []`.
- **Pre-match polling window is ±30min:** `checkPreMatch()` looks at `[-30min, +30min]` from now, not just future matches. Without the past window, the worker drops from 1-min to 15-min polling right when a match starts (because `scheduledAt` moves into the past but DB still says SCHEDULED).
- **`checkIsMatchDay()` uses `Intl.DateTimeFormat`:** Do not use `new Date(toLocaleString())` for timezone conversion — it's unreliable across Node.js versions. Use `Intl.DateTimeFormat.formatToParts()` instead.

## SEO & Domain

**Domain:** centrepass.io — site will be hosted here.

**Competitor landscape:** Low-competition niche. No dedicated independent SSN scores site exists. Official sites (netball.com.au) have poor web SEO. Media giants (Fox, Nine) treat netball as afterthought. Nobody runs Google Ads in this niche.

**Technical SEO implementation (all free):**
- `app/sitemap.ts` — dynamic sitemap with all match, team, player URLs
- `app/robots.ts` — allow all, block `/api/` and `/auth/`
- JSON-LD structured data on every page:
  - `SportsEvent` on match pages
  - `SportsTeam` on team pages
  - `Person` on player pages
  - `BreadcrumbList` on all pages (via layout)
  - `WebSite` on homepage
- `generateMetadata()` on every page with descriptive titles (e.g. "Vixens vs Fever - Round 5 Score | CentrePass")
- Google Search Console — verified (domain property via DNS TXT), sitemap submitted
- Google Analytics 4 — live, Measurement ID `G-CHLT6ZR1W7` (env var `NEXT_PUBLIC_GA4_ID` on Render)
- **TODO:** Bing Webmaster Tools (import from GSC), Ahrefs Webmaster Tools free tier (after site indexed ~2-4 weeks)

**Important:** Google's live score panels come from licensed data partners, NOT from website schema markup. Structured data helps with entity recognition and event listings, but won't generate score-specific rich results.

**No paid SEO needed:** Free tools (Google Search Console, GA4, Ahrefs Webmaster Tools free tier) cover everything. Paid tools (Ahrefs, SEMrush) are overkill for this niche.

## Project Structure

Personal project — repo lives in `~/Documents/personal/` (uses personal GitHub account: SilverCrocus).
