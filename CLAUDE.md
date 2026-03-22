# NETPULSE — Suncorp Super Netball Scores Website

Real SSN data displayed under the NETPULSE brand. Live scores, box scores, standings, fixtures, team profiles, and on-court visualization.

## Architecture

Next.js 15 Full-Stack Monolith with custom Express server for Socket.io. Deployed on Render (Sydney region).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Prisma ORM, Supabase PostgreSQL, NextAuth.js, Socket.io, Vitest

## Data Sources

- **Champion Data** (primary): `mc.championdata.com/data/` — free JSON endpoints, no auth. Scores, 48+ player stat fields, fixtures, score flow.
- **TheSportsDB** (secondary): Team badges, player photos. SSN league ID: 4540.

## Key Documents

- **Design spec:** `docs/superpowers/specs/2026-03-22-netpulse-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-03-23-netpulse-implementation.md` (17 tasks)
- **Stitch designs:** `stitch-designs/` (6 HTML prototypes as visual spec)

## Design Reference

UI designs are in `stitch-designs/` — each subfolder contains a `screenshot.png` (visual reference) and `index.html` (prototype code) generated from Google Stitch:

- `box-score-player-stats/` — Detailed player stats and box score layout
- `live-game-center/` — Real-time game tracking with quarter-by-quarter scoring
- `on-court-visualizer/` — Court diagram with player positions
- `fixtures-scores-hub/` — Schedule and results overview
- `league-standings/` — Team rankings table
- `team-profile-vipers/` — Individual team page (example: Vipers Athletics)

When building components, reference these designs as the visual spec. The HTML prototypes are self-contained and can be opened directly in a browser.

## Design System

- **Colors:** MD3 token set — canonical source is the Tailwind config in any Stitch `index.html`
- **Fonts:** Lexend (headlines), Manrope (body), Inter (labels)
- **Icons:** Material Symbols Outlined
- **Patterns:** `kinetic-gradient` (dark gradient headers), `pulse-live` (live indicator animation)

## Project Structure

Personal project — repo lives in `~/Documents/personal/` (uses personal GitHub account: SilverCrocus).

## Implementation

Follow the implementation plan task-by-task (17 tasks across 3 parts):
1. Foundation & Data Layer (Tasks 1-4): scaffolding, Prisma schema, Champion Data service, TheSportsDB service
2. UI Components & Pages (Tasks 5-11): AppShell, shared components, all 7 pages
3. Features & Deployment (Tasks 12-17): auth, live pages, real-time infrastructure, personalization, Render deploy
