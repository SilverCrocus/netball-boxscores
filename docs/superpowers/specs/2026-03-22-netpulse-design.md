# NETPULSE — Design Spec

A Suncorp Super Netball scores, stats, and live tracking website.

## Overview

NETPULSE displays real SSN data under a custom brand. Six pages covering fixtures, live scores, box scores, standings, team profiles, and on-court visualization. Users can sign in to follow teams and set match reminders.

## Architecture

**Next.js 15 Full-Stack Monolith** deployed on Render with a custom server for WebSocket support.

```
Render (Web Service)
├── Next.js 15 App Router (SSR + RSC)
├── API Routes (/api/scores, /api/fixtures, /api/standings)
├── Custom Server (Express + Socket.io)
└── Background Worker (polls Champion Data)

Supabase (Database)
└── PostgreSQL (Prisma ORM connection)

External APIs
├── Champion Data (mc.championdata.com) — scores, stats, fixtures
└── TheSportsDB — team badges, player photos
```

### Why This Architecture

- Single codebase and deployment — simplest to build and maintain
- Server Components for fast SSR with client hydration for interactivity
- Custom server needed for Socket.io (persistent WebSocket connections)
- Supabase PostgreSQL for free managed database
- Prisma ORM for type-safe database access
- Can be refactored into separate services later if needed

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15, App Router |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| Database | Supabase PostgreSQL |
| ORM | Prisma |
| Auth | NextAuth.js (credentials + Google OAuth) |
| Real-time | Socket.io (custom Express server) |
| Deployment | Render (Web Service) |
| Icons | Material Symbols Outlined |
| Fonts | Lexend (headlines), Manrope (body), Inter (labels) |

## Data Sources

### Champion Data (Primary)

Official SSN stats provider. Publicly accessible JSON endpoints, no authentication required.

| Endpoint | Data | URL Pattern |
|----------|------|-------------|
| Competitions | List of all competitions with IDs | `mc.championdata.com/data/competitions.json` |
| Fixture | Season schedule with match IDs | `mc.championdata.com/data/{compId}/fixture.json` |
| Match Stats | Full match data: 48+ player stat fields, quarter scores, score flow | `mc.championdata.com/data/{compId}/{matchId}.json` |

**Data freshness**: Real-time during live matches. Historical data available for past seasons.

**Polling strategy**:
- Live matches: every 30 seconds
- Match day (no live match): every 15 minutes
- Off-season/non-match day: every 6 hours

### TheSportsDB (Secondary)

Team media assets and metadata. SSN league ID: 4540.

- Team badges and banners
- Player photos and bios
- Basic fixture data (backup)
- Cost: $0-9/month (Patreon tiers)

### Wikipedia (Bootstrap)

CC BY-SA licensed historical data for seeding the database with past seasons.

## Pages & Routing

| Route | Page | Stitch Design |
|-------|------|---------------|
| `/` | Fixtures & Scores Hub | `fixtures-scores-hub/` |
| `/match/[matchId]` | Box Score / Player Stats | `box-score-player-stats/` |
| `/match/[matchId]/live` | Live Game Center | `live-game-center/` |
| `/match/[matchId]/court` | On-Court Visualizer | `on-court-visualizer/` |
| `/standings` | League Standings | `league-standings/` |
| `/team/[teamSlug]` | Team Profile | `team-profile-vipers/` |
| `/auth/signin` | Sign In | — |
| `/auth/signup` | Sign Up | — |
| `/settings` | User Settings | — |

## Layout & Navigation

**Desktop** (>=1024px): Fixed sidebar (264px) with navigation links + main content area.

**Mobile** (<1024px): Bottom navigation bar with 4-5 tabs.

Navigation items: Home (Fixtures), Standings, Teams, Live, Profile/Settings.

## Shared Components

| Component | Purpose | Used On |
|-----------|---------|---------|
| `AppShell` | Sidebar/bottom nav, responsive layout | All pages |
| `ScoreCard` | Match score display with team badges | Home, Standings, Team Profile |
| `PlayerStatsTable` | Sortable stats grid | Box Score, Team Profile |
| `LiveIndicator` | Pulsing "LIVE" badge | Home, Live Game Center |
| `QuarterScoreBar` | Quarter-by-quarter score bars | Box Score, Live Game Center |
| `NetballCourt` | SVG court with position plotting | On-Court Visualizer |
| `MatchMomentum` | Score flow over time chart | Box Score, Live Game Center |
| `TeamBadge` | Team logo with name | Throughout |
| `StatCard` | Bento-style stat display | Standings, Team Profile |

## Real-Time Architecture

```
Champion Data API
    │ (poll every 30s during live matches)
    ▼
Background Worker (Node.js interval)
    │ (detect score/stat changes)
    ▼
Supabase PostgreSQL (update match data)
    │
    ▼
Socket.io Server (broadcast to match rooms)
    │
    ▼
Connected Clients (join room per match)
```

1. Background worker polls Champion Data for active matches
2. On data change, updates PostgreSQL via Prisma
3. Emits Socket.io event to `match:{matchId}` room
4. Client components receive delta updates and re-render
5. Pages SSR on initial load, then hydrate with WebSocket for live updates

## Authentication & Personalization

**NextAuth.js** with Prisma adapter storing sessions in Supabase PostgreSQL.

Providers:
- Credentials (email + password)
- Google OAuth

User features:
- **My Teams**: Follow teams — shown first in fixtures, highlighted in standings
- **Match Reminders**: "Get Reminded" stores preference, triggers browser push notification
- **Favorites**: Bookmark matches for quick access

## Database Schema

```prisma
model Competition {
  id               String   @id @default(cuid())
  name             String
  season           Int
  championDataId   Int      @unique
  teams            Team[]
  matches          Match[]
}

model Team {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  abbreviation    String
  logoUrl         String?
  bannerUrl       String?
  primaryColor    String?
  secondaryColor  String?
  competitionId   String
  competition     Competition @relation(fields: [competitionId], references: [id])
  players         Player[]
  homeMatches     Match[]  @relation("HomeTeam")
  awayMatches     Match[]  @relation("AwayTeam")
  followers       UserTeam[]
}

model Player {
  id              String   @id @default(cuid())
  name            String
  position        String
  photoUrl        String?
  teamId          String
  team            Team     @relation(fields: [teamId], references: [id])
  matchStats      PlayerMatchStats[]
}

model Match {
  id                  String   @id @default(cuid())
  competitionId       String
  competition         Competition @relation(fields: [competitionId], references: [id])
  homeTeamId          String
  homeTeam            Team     @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeamId          String
  awayTeam            Team     @relation("AwayTeam", fields: [awayTeamId], references: [id])
  round               Int
  venue               String
  scheduledAt         DateTime
  status              MatchStatus @default(SCHEDULED)
  homeScore           Int      @default(0)
  awayScore           Int      @default(0)
  currentQuarter      Int?
  currentTime         String?
  championDataMatchId Int?     @unique
  quarters            MatchQuarter[]
  playerStats         PlayerMatchStats[]
  scoreFlow           ScoreFlow[]
  reminders           UserReminder[]
}

enum MatchStatus {
  SCHEDULED
  LIVE
  COMPLETED
}

model MatchQuarter {
  id        String @id @default(cuid())
  matchId   String
  match     Match  @relation(fields: [matchId], references: [id])
  quarter   Int
  homeScore Int
  awayScore Int

  @@unique([matchId, quarter])
}

model PlayerMatchStats {
  id           String @id @default(cuid())
  playerId     String
  player       Player @relation(fields: [playerId], references: [id])
  matchId      String
  match        Match  @relation(fields: [matchId], references: [id])
  goals        Int    @default(0)
  attempts     Int    @default(0)
  goalAssists  Int    @default(0)
  intercepts   Int    @default(0)
  deflections  Int    @default(0)
  rebounds     Int    @default(0)
  penalties    Int    @default(0)
  feeds        Int    @default(0)
  centrePassReceives Int @default(0)
  turnovers    Int    @default(0)
  minutesPlayed Float @default(0)

  @@unique([playerId, matchId])
}

model ScoreFlow {
  id        String   @id @default(cuid())
  matchId   String
  match     Match    @relation(fields: [matchId], references: [id])
  timestamp DateTime
  period    Int
  teamId    String
  homeScore Int
  awayScore Int
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  image         String?
  passwordHash  String?
  accounts      Account[]
  sessions      Session[]
  teams         UserTeam[]
  reminders     UserReminder[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String
  provider          String
  providerAccountId String

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expires      DateTime
}

model UserTeam {
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  teamId String
  team   Team   @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@id([userId, teamId])
}

model UserReminder {
  userId  String
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  matchId String
  match   Match  @relation(fields: [matchId], references: [id], onDelete: Cascade)

  @@id([userId, matchId])
}
```

## Design System

Carried forward from Stitch prototypes. All 6 designs share the same token system.

### Colors (MD3 Tokens)

```
primary:                 #000613
primary-container:       #001f3f
secondary:               #006e0a
secondary-container:     #69fd5d
secondary-fixed:         #75ff68
secondary-fixed-dim:     #4ce346
surface:                 #faf9fc
surface-container-lowest:#ffffff
surface-container-low:   #f4f3f6
surface-container:       #eeedf0
on-surface:              #1a1c1e
on-surface-variant:      #43474e
outline:                 #74777f
outline-variant:         #c4c6cf
error:                   #ba1a1a
```

### Typography

| Role | Font | Usage |
|------|------|-------|
| Headline | Lexend | Page titles, hero text, scores |
| Body | Manrope | Paragraphs, descriptions, table content |
| Label | Inter | Navigation, badges, metadata |

### Key Visual Patterns

- **kinetic-gradient**: Dark gradient (`#000613` to `#001f3f`) for hero headers
- **pulse-live**: Pulsing green dot animation for live indicators
- **Bento grid**: Card-based stat displays with rounded corners and subtle shadows
- **Green accents**: `#006e0a` / `#69fd5d` for CTAs, live states, and highlights

## Deployment (Render)

- **Web Service**: Node.js runtime (not serverless — required for Socket.io)
- **Build command**: `npx prisma generate && npm run build`
- **Start command**: `node server.js` (custom Express server wrapping Next.js)
- **Environment variables**: `DATABASE_URL` (Supabase connection string), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Region**: Sydney (closest to Australian users)

## Error Handling

- Champion Data unavailable: serve cached data from PostgreSQL, show "Last updated X minutes ago"
- WebSocket disconnect: auto-reconnect with exponential backoff, fall back to polling
- Auth failures: redirect to sign-in with return URL
- Rate limiting: respect Champion Data (unknown limits — start conservative at 30s polls)

## Testing Strategy

- **Unit tests**: Vitest for data transformation functions (Champion Data JSON parsing, stat calculations)
- **Component tests**: React Testing Library for shared components
- **E2E tests**: Playwright for critical flows (view fixtures, open match, check standings)
- **API integration tests**: Mock Champion Data responses for API route testing
