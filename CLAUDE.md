# CentrePass — Suncorp Super Netball Scores Website

Real SSN data displayed under the CentrePass brand at centrepass.io. Live scores, box scores, standings, fixtures, team profiles, player profiles, and on-court visualization.

## Architecture

Next.js 15 Full-Stack Monolith with custom Express server for Socket.io. Deployed on Render (Sydney region).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Prisma 6.x, Supabase PostgreSQL, NextAuth.js, Socket.io, Vitest

## Data Sources

- **Champion Data** (primary): `mc.championdata.com/data/` — free JSON endpoints, no auth. 2026 SSN competition ID: **12949**.
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

## Shared Components

- **`TeamBadge`** (`src/components/ui/TeamBadge.tsx`): Renders team logo with letter fallback. Use this instead of inline letter placeholders. Props: `team` (name/abbreviation/logoUrl), `size` (px), `variant` ('home'|'away').
- **`ScoreCard`** (`src/components/ui/ScoreCard.tsx`): Match result card with team badges, scores, date, round, and venue.

## Shared Utilities

- **`src/lib/navigation.ts`**: `NAV_ITEMS` array — single source of truth for sidebar and bottom nav links. Each item has `href`, `label`, `icon`, and optional `sidebarLabel`. Also exports `isActive(pathname, href)` for nav highlight logic.
- **`src/lib/api-auth.ts`**: `requireAuth()` (returns session or 401 response) and `badRequest(msg)` helpers for API routes.
- **`src/lib/format.ts`**: `formatMatchDate(date)`, `formatMatchTime(date)`, `formatShortDate(date)`, `computeAge(dob)` — shared date formatting and age computation.
- **`src/lib/stat-utils.ts`**: `getStatValue(stat, field)` — shared stat accessor with computed `shootingPct` field. Used by PlayerSeasonStats, PlayerCharts, PlayerGameLog, and the player page.
- **`src/lib/user-resource-route.ts`**: `createUserResourceHandlers(config)` — factory for user CRUD API routes (favorites, reminders, teams). Each route file is ~7 lines.
- **`src/types/team.ts`**: `TeamInfo` and `TeamInfoWithId` — shared team type used by ScoreCard, LiveScoreHero, PlayerGameLog, settings page.

## Player Profile Components

`src/components/player/` — position-adaptive template system:
- **`position-config.ts`**: `getPositionConfig(position)` maps Position enum → group (shooter/defender/midcourt), stat highlights, game log columns, chart config. Single source of truth for position-specific rendering.
- **`PlayerHero.tsx`**: Compact kinetic-gradient hero with ghost text watermark (last name, `text-white/[0.03]`). Content-driven height (no min-height). Photo, stacked name, position badge, bio line, stat highlight cards.
- **`PlayerBioCard.tsx`**: Biography text card with read-more toggle. Only rendered when biography exists.
- **`PlayerSeasonStats.tsx`**: Totals + per-game averages with trend indicators. Position-aware stat highlights.
- **`PlayerCharts.tsx`**: CSS/SVG charts — donut (shooters), stacked bar (defenders), feed distribution (midcourt). No external charting library.
- **`PlayerGameLog.tsx`**: Match-by-match stats table with position-specific columns, opponent badges, W/L indicators.

Team roster rows (`/team/[teamSlug]`) link to `/player/[playerId]`.

## Gotchas

- **Prisma 7 breaks builds:** Always use Prisma 6.x. Import from `@prisma/client`.
- **Champion Data field names:** API uses `roundNumber` not `round`, `homeSquadScore` not `homeScore`, `matchStatus` values are lowercase ("complete" not "Complete")
- **TheSportsDB endpoint:** Must use `search_all_teams.php?l=` not `lookup_all_teams.php?id=` — the latter returns English football teams
- **Next.js 15 async params:** Page params are `Promise<{ param: string }>` — must `await params`
- **Supabase direct connection:** Use pooler session mode (port 5432) as `DIRECT_URL`, not `db.xxx.supabase.co`
- **Match sorting:** Queries use `scheduledAt: 'asc'`. For completed matches (results), reverse to show most-recent-first. For upcoming fixtures filtered from a desc-sorted list, reverse to show nearest-first.
- **Prisma nullable narrowing:** After `if (!match) return notFound()`, use `NonNullable<typeof match>` in function parameter types — TypeScript doesn't narrow through hoisted function declarations.
- **Prisma AI safety check:** `prisma migrate reset` and destructive commands require `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="yes"` env var when run from an AI agent. Use `npx prisma db push --force-reset` as an alternative.

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
- Google Search Console + GA4 registration after deployment

**Important:** Google's live score panels come from licensed data partners, NOT from website schema markup. Structured data helps with entity recognition and event listings, but won't generate score-specific rich results.

**No paid SEO needed:** Free tools (Google Search Console, GA4, Ahrefs Webmaster Tools free tier) cover everything. Paid tools (Ahrefs, SEMrush) are overkill for this niche.

## Project Structure

Personal project — repo lives in `~/Documents/personal/` (uses personal GitHub account: SilverCrocus).
