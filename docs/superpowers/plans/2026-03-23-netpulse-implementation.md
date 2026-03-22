# NETPULSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full Suncorp Super Netball scores, stats, and live tracking website with 7 pages, real-time updates, and user personalization.

**Architecture:** Next.js 15 Full-Stack Monolith with custom Express server for Socket.io WebSocket support. Supabase PostgreSQL via Prisma ORM. Champion Data JSON API as primary data source, TheSportsDB for media assets.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Prisma, Supabase PostgreSQL, NextAuth.js, Socket.io, Vitest, React Testing Library, Render (deployment)

**Spec:** `docs/superpowers/specs/2026-03-22-netpulse-design.md`

**Stitch Designs:** `stitch-designs/` (6 HTML prototypes serve as visual spec)

---

## Part 1: Foundation & Data Layer (Tasks 1-4)


---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `server.ts`, `.env.example`, `.gitignore`, `eslint.config.mjs`
- Create: `src/components/.gitkeep`, `src/lib/.gitkeep`, `src/types/.gitkeep`

---

- [ ] **Step 1: Initialize Next.js 15 project with TypeScript and Tailwind CSS 4**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
```

Accept defaults. This generates the base Next.js 15 project with App Router, TypeScript, Tailwind CSS 4, and ESLint.

After running, verify:

```bash
ls src/app/layout.tsx src/app/page.tsx next.config.ts tsconfig.json tailwind.config.ts
# All files should exist
```

- [ ] **Step 2: Create project directory structure**

```bash
mkdir -p src/components src/lib src/types
```

- [ ] **Step 3: Install all dependencies**

```bash
npm install prisma @prisma/client socket.io socket.io-client next-auth @auth/prisma-adapter express
npm install -D @types/express @types/node vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

Verify:

```bash
npx prisma --version
# Should output Prisma CLI version
```

- [ ] **Step 4: Configure fonts via next/font/google**

Replace `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Lexend, Manrope, Inter } from "next/font/google";
import "./globals.css";

const lexend = Lexend({
  subsets: ["latin"],
  variable: "--font-headline",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-label",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NETPULSE — Suncorp Super Netball Scores & Stats",
  description:
    "Live scores, box scores, standings, and player stats for Suncorp Super Netball.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${lexend.variable} ${manrope.variable} ${inter.variable}`}
    >
      <body className="bg-surface text-on-surface font-body antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Add Material Symbols Outlined**

In `src/app/layout.tsx`, add inside `<head>` (or use next/head metadata):

Add a `src/app/globals.css` that imports Material Symbols:

```css
@import "tailwindcss";
@import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap");

@theme {
  /* Fonts — next/font injects font-family on these same CSS variables */
  --font-headline: var(--font-headline), "Lexend", sans-serif;
  --font-body: var(--font-body), "Manrope", sans-serif;
  --font-label: var(--font-label), "Inter", sans-serif;

  /* MD3 Color Tokens — full set from Stitch prototypes */
  --color-primary: #000613;
  --color-on-primary: #ffffff;
  --color-primary-container: #001f3f;
  --color-on-primary-container: #6f88ad;
  --color-primary-fixed: #d4e3ff;
  --color-primary-fixed-dim: #afc8f0;
  --color-on-primary-fixed: #001c3a;
  --color-on-primary-fixed-variant: #2f486a;
  --color-inverse-primary: #afc8f0;

  --color-secondary: #006e0a;
  --color-on-secondary: #ffffff;
  --color-secondary-container: #69fd5d;
  --color-on-secondary-container: #00730b;
  --color-secondary-fixed: #75ff68;
  --color-secondary-fixed-dim: #4ce346;
  --color-on-secondary-fixed: #002201;
  --color-on-secondary-fixed-variant: #005306;

  --color-tertiary: #000700;
  --color-on-tertiary: #ffffff;
  --color-tertiary-container: #002501;
  --color-on-tertiary-container: #009c14;
  --color-tertiary-fixed: #75ff68;
  --color-tertiary-fixed-dim: #4ce346;
  --color-on-tertiary-fixed: #002201;
  --color-on-tertiary-fixed-variant: #005306;

  --color-error: #ba1a1a;
  --color-on-error: #ffffff;
  --color-error-container: #ffdad6;
  --color-on-error-container: #93000a;

  --color-surface: #faf9fc;
  --color-on-surface: #1a1c1e;
  --color-surface-variant: #e3e2e5;
  --color-on-surface-variant: #43474e;
  --color-surface-dim: #dbd9dd;
  --color-surface-bright: #faf9fc;
  --color-surface-container-lowest: #ffffff;
  --color-surface-container-low: #f4f3f6;
  --color-surface-container: #efedf0;
  --color-surface-container-high: #e9e7eb;
  --color-surface-container-highest: #e3e2e5;
  --color-surface-tint: #476083;

  --color-outline: #74777f;
  --color-outline-variant: #c4c6cf;

  --color-inverse-surface: #2f3033;
  --color-inverse-on-surface: #f2f0f3;

  --color-background: #faf9fc;
  --color-on-background: #1a1c1e;
}

.material-symbols-outlined {
  font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
  display: inline-block;
  line-height: 1;
  text-transform: none;
  letter-spacing: normal;
  word-wrap: normal;
  white-space: nowrap;
  direction: ltr;
}
```

Verify Tailwind picks up tokens:

```bash
npm run dev &
sleep 5
curl -s http://localhost:3000 | grep "surface" && echo "Tokens working"
kill %1
```

- [ ] **Step 6: Create the custom Express server for Socket.io**

Create `server.ts`:

```ts
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const expressApp = express();
  const httpServer = createServer(expressApp);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: dev ? "http://localhost:3000" : process.env.NEXTAUTH_URL,
      methods: ["GET", "POST"],
    },
  });

  // Socket.io connection handling
  io.on("connection", (socket) => {
    console.log(`[socket.io] Client connected: ${socket.id}`);

    socket.on("match:subscribe", ({ matchId }: { matchId: string }) => {
      socket.join(`match:${matchId}`);
      console.log(`[socket.io] ${socket.id} joined match:${matchId}`);
    });

    socket.on("match:unsubscribe", ({ matchId }: { matchId: string }) => {
      socket.leave(`match:${matchId}`);
      console.log(`[socket.io] ${socket.id} left match:${matchId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[socket.io] Client disconnected: ${socket.id}`);
    });
  });

  // Make io accessible to API routes via Express app locals
  expressApp.set("io", io);

  // Let Next.js handle all other routes
  expressApp.all("/{*path}", (req, res) => {
    return handle(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`> NETPULSE ready on http://${hostname}:${port}`);
    console.log(`> Socket.io server attached`);
  });
});
```

- [ ] **Step 7: Update package.json scripts and create .env.example**

Add/update scripts in `package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "npx prisma generate && next build",
    "start": "NODE_ENV=production npx tsx server.ts",
    "lint": "next lint",
    "test": "vitest",
    "test:run": "vitest run",
    "db:push": "npx prisma db push",
    "db:seed": "npx tsx prisma/seed.ts",
    "db:studio": "npx prisma studio"
  }
}
```

Also install `tsx` for server development:

```bash
npm install -D tsx
```

Create `.env.example`:

```env
# Database (Supabase PostgreSQL)
DATABASE_URL="postgresql://user:password@host:5432/dbname"

# NextAuth
NEXTAUTH_SECRET="generate-a-secret-here"
NEXTAUTH_URL="http://localhost:3000"

# Google OAuth
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""

# Champion Data
CHAMPION_DATA_BASE_URL="https://mc.championdata.com/data"

# TheSportsDB
THESPORTSDB_API_KEY=""
THESPORTSDB_BASE_URL="https://www.thesportsdb.com/api/v1/json"
```

- [ ] **Step 8: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 9: Verify everything compiles**

```bash
npm run build
# Expected: Build completes with no errors
# Output should show: ✓ Compiled successfully
```

- [ ] **Step 10: Commit scaffolding**

```bash
git add -A
git commit -m "Initialize Next.js 15 project with Tailwind CSS 4, Socket.io server, and MD3 design tokens"
```

---

## Task 2: Database Schema (Prisma)

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`
- Test: `src/lib/__tests__/prisma-schema.test.ts`

---

- [ ] **Step 1: Write a schema validation test**

Create `src/lib/__tests__/prisma-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

describe("Prisma Schema", () => {
  it("schema file exists", () => {
    const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    expect(fs.existsSync(schemaPath)).toBe(true);
  });

  it("schema is valid (prisma validate)", () => {
    const result = execSync("npx prisma validate", {
      encoding: "utf-8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://test:test@localhost:5432/test?schema=public",
      },
    });
    expect(result).toContain("is valid");
  });

  it("schema contains all required models", () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );
    const requiredModels = [
      "Competition",
      "Team",
      "Standing",
      "Player",
      "Match",
      "MatchQuarter",
      "PlayerMatchStats",
      "ScoreFlow",
      "User",
      "Account",
      "Session",
      "VerificationToken",
      "UserTeam",
      "UserReminder",
      "UserFavorite",
    ];
    for (const model of requiredModels) {
      expect(schema).toContain(`model ${model}`);
    }
  });

  it("schema contains required enums", () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8"
    );
    expect(schema).toContain("enum Position");
    expect(schema).toContain("enum MatchStatus");
  });
});
```

Run the test — it should fail:

```bash
npx vitest run src/lib/__tests__/prisma-schema.test.ts
# Expected: FAIL — schema file does not exist
```

- [ ] **Step 2: Create the full Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ───── Competition & Teams ─────

model Competition {
  id             String     @id @default(cuid())
  name           String
  season         Int
  championDataId Int        @unique
  seasonStart    DateTime?
  seasonEnd      DateTime?
  teams          Team[]
  matches        Match[]
  standings      Standing[]
}

model Team {
  id                 String      @id @default(cuid())
  name               String
  slug               String      @unique
  abbreviation       String
  logoUrl            String?
  bannerUrl          String?
  primaryColor       String?
  secondaryColor     String?
  championDataTeamId Int?        @unique
  competitionId      String
  competition        Competition @relation(fields: [competitionId], references: [id])
  players            Player[]
  homeMatches        Match[]     @relation("HomeTeam")
  awayMatches        Match[]     @relation("AwayTeam")
  followers          UserTeam[]
  standings          Standing[]
  scoredFlows        ScoreFlow[] @relation("ScoringTeam")
}

model Standing {
  id             String      @id @default(cuid())
  competitionId  String
  competition    Competition @relation(fields: [competitionId], references: [id])
  teamId         String
  team           Team        @relation(fields: [teamId], references: [id])
  rank           Int
  played         Int         @default(0)
  wins           Int         @default(0)
  losses         Int         @default(0)
  draws          Int         @default(0)
  goalsFor       Int         @default(0)
  goalsAgainst   Int         @default(0)
  goalPercentage Float       @default(0)
  points         Int         @default(0)
  updatedAt      DateTime    @updatedAt

  @@unique([competitionId, teamId])
  @@index([competitionId, rank])
}

// ───── Players ─────

enum Position {
  GS
  GA
  WA
  C
  WD
  GD
  GK
}

model Player {
  id                   String             @id @default(cuid())
  name                 String
  position             Position
  photoUrl             String?
  championDataPlayerId Int?               @unique
  teamId               String
  team                 Team               @relation(fields: [teamId], references: [id])
  matchStats           PlayerMatchStats[]
}

// ───── Matches ─────

enum MatchStatus {
  SCHEDULED
  LIVE
  COMPLETED
}

model Match {
  id                  String             @id @default(cuid())
  competitionId       String
  competition         Competition        @relation(fields: [competitionId], references: [id])
  homeTeamId          String
  homeTeam            Team               @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeamId          String
  awayTeam            Team               @relation("AwayTeam", fields: [awayTeamId], references: [id])
  round               Int
  venue               String
  scheduledAt         DateTime
  status              MatchStatus        @default(SCHEDULED)
  homeScore           Int                @default(0)
  awayScore           Int                @default(0)
  currentQuarter      Int?
  currentTime         String?
  championDataMatchId Int?               @unique
  quarters            MatchQuarter[]
  playerStats         PlayerMatchStats[]
  scoreFlow           ScoreFlow[]
  reminders           UserReminder[]
  favorites           UserFavorite[]
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
  id                 String @id @default(cuid())
  playerId           String
  player             Player @relation(fields: [playerId], references: [id])
  matchId            String
  match              Match  @relation(fields: [matchId], references: [id])
  goals              Int    @default(0)
  attempts           Int    @default(0)
  goalAssists        Int    @default(0)
  intercepts         Int    @default(0)
  deflections        Int    @default(0)
  rebounds           Int    @default(0)
  penalties          Int    @default(0)
  feeds              Int    @default(0)
  centrePassReceives Int    @default(0)
  turnovers          Int    @default(0)
  minutesPlayed      Float  @default(0)

  @@unique([playerId, matchId])
}

model ScoreFlow {
  id            String @id @default(cuid())
  matchId       String
  match         Match  @relation(fields: [matchId], references: [id])
  period        Int
  periodSeconds Int
  scoringTeamId String
  scoringTeam   Team   @relation("ScoringTeam", fields: [scoringTeamId], references: [id])
  homeScore     Int
  awayScore     Int

  @@index([matchId, period])
}

// ───── Auth (NextAuth.js + Prisma Adapter) ─────

model User {
  id           String         @id @default(cuid())
  email        String         @unique
  name         String?
  image        String?
  passwordHash String?
  accounts     Account[]
  sessions     Session[]
  teams        UserTeam[]
  reminders    UserReminder[]
  favorites    UserFavorite[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expires      DateTime
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ───── User Personalization ─────

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

model UserFavorite {
  userId  String
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  matchId String
  match   Match  @relation(fields: [matchId], references: [id], onDelete: Cascade)

  @@id([userId, matchId])
}
```

Run the test again:

```bash
npx vitest run src/lib/__tests__/prisma-schema.test.ts
# Expected: PASS — all 4 tests pass
```

- [ ] **Step 3: Generate Prisma client**

```bash
npx prisma generate
# Expected: ✓ Generated Prisma Client
```

- [ ] **Step 4: Create the Prisma client singleton**

Create `src/lib/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

This prevents multiple Prisma Client instances during hot-reload in development. All application code should import from `@/lib/db`.

- [ ] **Step 5: Create the seed script**

Create `prisma/seed.ts`:

```ts
import { PrismaClient, Position, MatchStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.scoreFlow.deleteMany();
  await prisma.playerMatchStats.deleteMany();
  await prisma.matchQuarter.deleteMany();
  await prisma.userFavorite.deleteMany();
  await prisma.userReminder.deleteMany();
  await prisma.userTeam.deleteMany();
  await prisma.match.deleteMany();
  await prisma.standing.deleteMany();
  await prisma.player.deleteMany();
  await prisma.team.deleteMany();
  await prisma.competition.deleteMany();

  // Create 2 competitions
  const comp2025 = await prisma.competition.create({
    data: {
      name: "Suncorp Super Netball 2025",
      season: 2025,
      championDataId: 10724,
      seasonStart: new Date("2025-03-29"),
      seasonEnd: new Date("2025-08-10"),
    },
  });

  const comp2026 = await prisma.competition.create({
    data: {
      name: "Suncorp Super Netball 2026",
      season: 2026,
      championDataId: 10850,
      seasonStart: new Date("2026-03-28"),
      seasonEnd: new Date("2026-08-09"),
    },
  });

  // 8 SSN teams (2026 season)
  const teamData = [
    {
      name: "Melbourne Vixens",
      slug: "melbourne-vixens",
      abbreviation: "VIX",
      primaryColor: "#E31837",
      secondaryColor: "#000000",
      championDataTeamId: 810,
    },
    {
      name: "West Coast Fever",
      slug: "west-coast-fever",
      abbreviation: "FEV",
      primaryColor: "#00A651",
      secondaryColor: "#FDB515",
      championDataTeamId: 811,
    },
    {
      name: "NSW Swifts",
      slug: "nsw-swifts",
      abbreviation: "SWI",
      primaryColor: "#E4002B",
      secondaryColor: "#002D62",
      championDataTeamId: 812,
    },
    {
      name: "Queensland Firebirds",
      slug: "queensland-firebirds",
      abbreviation: "FIR",
      primaryColor: "#7B2D8E",
      secondaryColor: "#F47920",
      championDataTeamId: 813,
    },
    {
      name: "Adelaide Thunderbirds",
      slug: "adelaide-thunderbirds",
      abbreviation: "THU",
      primaryColor: "#E91C72",
      secondaryColor: "#1E1E1E",
      championDataTeamId: 814,
    },
    {
      name: "GIANTS Netball",
      slug: "giants-netball",
      abbreviation: "GIA",
      primaryColor: "#F47B20",
      secondaryColor: "#2B2B2B",
      championDataTeamId: 815,
    },
    {
      name: "Collingwood Magpies",
      slug: "collingwood-magpies",
      abbreviation: "MAG",
      primaryColor: "#000000",
      secondaryColor: "#FFFFFF",
      championDataTeamId: 816,
    },
    {
      name: "Sunshine Coast Lightning",
      slug: "sunshine-coast-lightning",
      abbreviation: "LIG",
      primaryColor: "#702F8A",
      secondaryColor: "#FFD100",
      championDataTeamId: 817,
    },
  ];

  const teams = [];
  for (const td of teamData) {
    const team = await prisma.team.create({
      data: { ...td, competitionId: comp2026.id },
    });
    teams.push(team);
  }

  // Create 3 players per team (GS, C, GK as representative positions)
  const positionsPerTeam: Position[] = [Position.GS, Position.C, Position.GK];
  const playerNames = [
    ["Mwai Kumwenda", "Kate Moloney", "Emily Mannix"],
    ["Jhaniele Fowler", "Verity Simmons", "Courtney Bruce"],
    ["Sophie Garbin", "Maddy Proud", "Sarah Klau"],
    ["Donnell Wallam", "Kim Ravaillion", "Ruby Bakewell-Doran"],
    ["Lenize Potgieter", "Georgie Horjus", "Shamera Sterling"],
    ["Sophie Dwyer", "Amy Parmenter", "April Brandley"],
    ["Shimona Nelson", "Kelsey Browne", "Geva Mentor"],
    ["Cara Koenen", "Laura Langman", "Phumza Maweni"],
  ];

  const allPlayers = [];
  for (let t = 0; t < teams.length; t++) {
    for (let p = 0; p < positionsPerTeam.length; p++) {
      const player = await prisma.player.create({
        data: {
          name: playerNames[t][p],
          position: positionsPerTeam[p],
          teamId: teams[t].id,
          championDataPlayerId: 9000 + t * 10 + p,
        },
      });
      allPlayers.push(player);
    }
  }

  // Create 4 matches (2 completed, 1 live, 1 scheduled)
  const match1 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[0].id, // Vixens
      awayTeamId: teams[1].id, // Fever
      round: 1,
      venue: "John Cain Arena",
      scheduledAt: new Date("2026-03-28T06:00:00Z"),
      status: MatchStatus.COMPLETED,
      homeScore: 64,
      awayScore: 58,
      championDataMatchId: 115001,
    },
  });

  const match2 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[2].id, // Swifts
      awayTeamId: teams[3].id, // Firebirds
      round: 1,
      venue: "Ken Rosewall Arena",
      scheduledAt: new Date("2026-03-28T08:00:00Z"),
      status: MatchStatus.COMPLETED,
      homeScore: 55,
      awayScore: 62,
      championDataMatchId: 115002,
    },
  });

  const match3 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[4].id, // Thunderbirds
      awayTeamId: teams[5].id, // GIANTS
      round: 2,
      venue: "Adelaide Entertainment Centre",
      scheduledAt: new Date("2026-04-04T07:00:00Z"),
      status: MatchStatus.LIVE,
      homeScore: 32,
      awayScore: 28,
      currentQuarter: 3,
      currentTime: "8:45",
      championDataMatchId: 115003,
    },
  });

  const match4 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[6].id, // Magpies
      awayTeamId: teams[7].id, // Lightning
      round: 2,
      venue: "John Cain Arena",
      scheduledAt: new Date("2026-04-05T06:00:00Z"),
      status: MatchStatus.SCHEDULED,
      championDataMatchId: 115004,
    },
  });

  // Quarter scores for completed match 1
  await prisma.matchQuarter.createMany({
    data: [
      { matchId: match1.id, quarter: 1, homeScore: 16, awayScore: 14 },
      { matchId: match1.id, quarter: 2, homeScore: 14, awayScore: 17 },
      { matchId: match1.id, quarter: 3, homeScore: 18, awayScore: 12 },
      { matchId: match1.id, quarter: 4, homeScore: 16, awayScore: 15 },
    ],
  });

  // Player stats for match 1 (Vixens GS)
  await prisma.playerMatchStats.create({
    data: {
      playerId: allPlayers[0].id, // Kumwenda (Vixens GS)
      matchId: match1.id,
      goals: 42,
      attempts: 45,
      goalAssists: 0,
      intercepts: 0,
      deflections: 1,
      rebounds: 4,
      penalties: 2,
      feeds: 3,
      centrePassReceives: 0,
      turnovers: 2,
      minutesPlayed: 60,
    },
  });

  // Score flow entries for match 1 Q1
  await prisma.scoreFlow.createMany({
    data: [
      {
        matchId: match1.id,
        period: 1,
        periodSeconds: 45,
        scoringTeamId: teams[0].id,
        homeScore: 1,
        awayScore: 0,
      },
      {
        matchId: match1.id,
        period: 1,
        periodSeconds: 90,
        scoringTeamId: teams[1].id,
        homeScore: 1,
        awayScore: 1,
      },
      {
        matchId: match1.id,
        period: 1,
        periodSeconds: 130,
        scoringTeamId: teams[0].id,
        homeScore: 2,
        awayScore: 1,
      },
    ],
  });

  // Standings for the 2026 competition
  for (let i = 0; i < teams.length; i++) {
    await prisma.standing.create({
      data: {
        competitionId: comp2026.id,
        teamId: teams[i].id,
        rank: i + 1,
        played: i < 4 ? 2 : 1,
        wins: i < 2 ? 2 : i < 4 ? 1 : 0,
        losses: i < 2 ? 0 : i < 4 ? 1 : i < 6 ? 1 : 0,
        draws: 0,
        goalsFor: 120 - i * 8,
        goalsAgainst: 100 + i * 3,
        goalPercentage: parseFloat(((120 - i * 8) / (100 + i * 3) * 100).toFixed(1)),
        points: i < 2 ? 8 : i < 4 ? 4 : 0,
      },
    });
  }

  console.log("Seed completed.");
  console.log(`  Competitions: 2`);
  console.log(`  Teams: ${teams.length}`);
  console.log(`  Players: ${allPlayers.length}`);
  console.log(`  Matches: 4 (2 completed, 1 live, 1 scheduled)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

Add seed config to `package.json`:

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 5: Run the schema tests**

```bash
npx vitest run src/lib/__tests__/prisma-schema.test.ts
# Expected: PASS — all 4 tests pass
# ✓ schema file exists
# ✓ schema is valid (prisma validate)
# ✓ schema contains all required models
# ✓ schema contains required enums
```

- [ ] **Step 6: Commit database schema**

```bash
git add prisma/ src/lib/__tests__/prisma-schema.test.ts
git commit -m "Add Prisma schema with all models, enums, and seed script"
```

---

## Task 3: Champion Data Service

**Files:**
- Create: `src/types/champion-data.ts`
- Create: `src/lib/champion-data.ts`
- Test: `src/lib/__tests__/champion-data.test.ts`

---

- [ ] **Step 1: Define TypeScript interfaces for Champion Data responses**

Create `src/types/champion-data.ts`:

```ts
// ───── Competitions endpoint response ─────
// GET mc.championdata.com/data/competitions.json

export interface CDCompetitionsResponse {
  competitions: CDCompetition[];
}

export interface CDCompetition {
  id: number;
  name: string;
  season: number;
  sport: string;
}

// ───── Fixture endpoint response ─────
// GET mc.championdata.com/data/{compId}/fixture.json

export interface CDFixtureResponse {
  fixture: CDFixtureMatch[];
}

export interface CDFixtureMatch {
  matchId: number;
  round: number;
  roundName: string;
  homeSquadId: number;
  homeSquadName: string;
  awaySquadId: number;
  awaySquadName: string;
  venue: string;
  localStartTime: string; // ISO 8601
  utcStartTime: string;
  homeScore?: number;
  awayScore?: number;
  matchStatus: string; // "Scheduled" | "Playing" | "Complete"
}

// ───── Match Stats endpoint response ─────
// GET mc.championdata.com/data/{compId}/{matchId}.json

export interface CDMatchStatsResponse {
  matchInfo: CDMatchInfo;
  scoreFlow: CDScoreFlowEntry[];
  teamStats: {
    home: CDTeamStats;
    away: CDTeamStats;
  };
  playerStats: {
    home: CDPlayerStats[];
    away: CDPlayerStats[];
  };
  periodScores: CDPeriodScore[];
}

export interface CDMatchInfo {
  matchId: number;
  round: number;
  venue: string;
  homeSquadId: number;
  homeSquadName: string;
  awaySquadId: number;
  awaySquadName: string;
  homeScore: number;
  awayScore: number;
  matchStatus: string;
  period: number;
  periodSeconds: number;
}

export interface CDScoreFlowEntry {
  period: number;
  periodSeconds: number;
  squadId: number;
  scorepoints: number;
  homeScore: number;
  awayScore: number;
}

export interface CDTeamStats {
  squadId: number;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centrePassReceives: number;
  turnovers: number;
}

export interface CDPlayerStats {
  playerId: number;
  displayName: string;
  position: string; // "GS", "GA", etc.
  squadId: number;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centrePassReceives: number;
  turnovers: number;
  minutesPlayed: number;
}

export interface CDPeriodScore {
  period: number;
  homeScore: number;
  awayScore: number;
}
```

- [ ] **Step 2: Write failing tests for Champion Data service**

Create `src/lib/__tests__/champion-data.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchCompetitions,
  fetchFixture,
  fetchMatchStats,
  transformFixtureMatch,
  transformPlayerStats,
} from "@/lib/champion-data";
import type {
  CDCompetitionsResponse,
  CDFixtureResponse,
  CDMatchStatsResponse,
  CDFixtureMatch,
  CDPlayerStats,
} from "@/types/champion-data";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ───── Mock data ─────

const mockCompetitionsResponse: CDCompetitionsResponse = {
  competitions: [
    { id: 10850, name: "Suncorp Super Netball 2026", season: 2026, sport: "netball" },
    { id: 10724, name: "Suncorp Super Netball 2025", season: 2025, sport: "netball" },
  ],
};

const mockFixtureResponse: CDFixtureResponse = {
  fixture: [
    {
      matchId: 115001,
      round: 1,
      roundName: "Round 1",
      homeSquadId: 810,
      homeSquadName: "Melbourne Vixens",
      awaySquadId: 811,
      awaySquadName: "West Coast Fever",
      venue: "John Cain Arena",
      localStartTime: "2026-03-28T17:00:00+11:00",
      utcStartTime: "2026-03-28T06:00:00Z",
      homeScore: 64,
      awayScore: 58,
      matchStatus: "Complete",
    },
  ],
};

const mockMatchStatsResponse: CDMatchStatsResponse = {
  matchInfo: {
    matchId: 115001,
    round: 1,
    venue: "John Cain Arena",
    homeSquadId: 810,
    homeSquadName: "Melbourne Vixens",
    awaySquadId: 811,
    awaySquadName: "West Coast Fever",
    homeScore: 64,
    awayScore: 58,
    matchStatus: "Complete",
    period: 4,
    periodSeconds: 0,
  },
  scoreFlow: [
    { period: 1, periodSeconds: 45, squadId: 810, scorepoints: 1, homeScore: 1, awayScore: 0 },
    { period: 1, periodSeconds: 90, squadId: 811, scorepoints: 1, homeScore: 1, awayScore: 1 },
  ],
  teamStats: {
    home: {
      squadId: 810,
      goals: 64,
      attempts: 70,
      goalAssists: 18,
      intercepts: 8,
      deflections: 14,
      rebounds: 12,
      penalties: 6,
      feeds: 42,
      centrePassReceives: 30,
      turnovers: 15,
    },
    away: {
      squadId: 811,
      goals: 58,
      attempts: 68,
      goalAssists: 14,
      intercepts: 6,
      deflections: 10,
      rebounds: 8,
      penalties: 8,
      feeds: 38,
      centrePassReceives: 28,
      turnovers: 18,
    },
  },
  playerStats: {
    home: [
      {
        playerId: 9000,
        displayName: "Mwai Kumwenda",
        position: "GS",
        squadId: 810,
        goals: 42,
        attempts: 45,
        goalAssists: 0,
        intercepts: 0,
        deflections: 1,
        rebounds: 4,
        penalties: 2,
        feeds: 3,
        centrePassReceives: 0,
        turnovers: 2,
        minutesPlayed: 60,
      },
    ],
    away: [
      {
        playerId: 9010,
        displayName: "Jhaniele Fowler",
        position: "GS",
        squadId: 811,
        goals: 38,
        attempts: 42,
        goalAssists: 0,
        intercepts: 0,
        deflections: 0,
        rebounds: 3,
        penalties: 1,
        feeds: 2,
        centrePassReceives: 0,
        turnovers: 3,
        minutesPlayed: 60,
      },
    ],
  },
  periodScores: [
    { period: 1, homeScore: 16, awayScore: 14 },
    { period: 2, homeScore: 14, awayScore: 17 },
    { period: 3, homeScore: 18, awayScore: 12 },
    { period: 4, homeScore: 16, awayScore: 15 },
  ],
};

// ───── Tests ─────

describe("Champion Data Service", () => {
  describe("fetchCompetitions", () => {
    it("fetches and returns competitions", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCompetitionsResponse,
      });

      const result = await fetchCompetitions();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mc.championdata.com/data/competitions.json",
        expect.objectContaining({ next: { revalidate: expect.any(Number) } })
      );
      expect(result.competitions).toHaveLength(2);
      expect(result.competitions[0].id).toBe(10850);
    });

    it("throws on fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

      await expect(fetchCompetitions()).rejects.toThrow("Champion Data API error: 500 Internal Server Error");
    });
  });

  describe("fetchFixture", () => {
    it("fetches fixture for a given competition", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockFixtureResponse,
      });

      const result = await fetchFixture(10850);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mc.championdata.com/data/10850/fixture.json",
        expect.any(Object)
      );
      expect(result.fixture).toHaveLength(1);
      expect(result.fixture[0].matchId).toBe(115001);
    });
  });

  describe("fetchMatchStats", () => {
    it("fetches match stats for a given competition and match", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockMatchStatsResponse,
      });

      const result = await fetchMatchStats(10850, 115001);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://mc.championdata.com/data/10850/115001.json",
        expect.any(Object)
      );
      expect(result.matchInfo.homeScore).toBe(64);
      expect(result.playerStats.home).toHaveLength(1);
    });
  });

  describe("transformFixtureMatch", () => {
    it("transforms CDFixtureMatch to Prisma-compatible format", () => {
      const cdMatch: CDFixtureMatch = mockFixtureResponse.fixture[0];
      const result = transformFixtureMatch(cdMatch, "comp-id-123");

      expect(result).toEqual({
        championDataMatchId: 115001,
        round: 1,
        venue: "John Cain Arena",
        scheduledAt: new Date("2026-03-28T06:00:00Z"),
        homeScore: 64,
        awayScore: 58,
        status: "COMPLETED",
        competitionId: "comp-id-123",
        homeChampionDataTeamId: 810,
        awayChampionDataTeamId: 811,
      });
    });

    it("maps 'Playing' status to LIVE", () => {
      const liveMatch: CDFixtureMatch = {
        ...mockFixtureResponse.fixture[0],
        matchStatus: "Playing",
      };
      const result = transformFixtureMatch(liveMatch, "comp-id-123");
      expect(result.status).toBe("LIVE");
    });

    it("maps 'Scheduled' status to SCHEDULED", () => {
      const scheduledMatch: CDFixtureMatch = {
        ...mockFixtureResponse.fixture[0],
        matchStatus: "Scheduled",
        homeScore: undefined,
        awayScore: undefined,
      };
      const result = transformFixtureMatch(scheduledMatch, "comp-id-123");
      expect(result.status).toBe("SCHEDULED");
      expect(result.homeScore).toBe(0);
      expect(result.awayScore).toBe(0);
    });
  });

  describe("transformPlayerStats", () => {
    it("transforms CDPlayerStats to Prisma-compatible format", () => {
      const cdPlayer: CDPlayerStats = mockMatchStatsResponse.playerStats.home[0];
      const result = transformPlayerStats(cdPlayer);

      expect(result).toEqual({
        championDataPlayerId: 9000,
        name: "Mwai Kumwenda",
        position: "GS",
        goals: 42,
        attempts: 45,
        goalAssists: 0,
        intercepts: 0,
        deflections: 1,
        rebounds: 4,
        penalties: 2,
        feeds: 3,
        centrePassReceives: 0,
        turnovers: 2,
        minutesPlayed: 60,
      });
    });
  });
});
```

Run the tests:

```bash
npx vitest run src/lib/__tests__/champion-data.test.ts
# Expected: FAIL — module @/lib/champion-data not found
```

- [ ] **Step 3: Implement the Champion Data service**

Create `src/lib/champion-data.ts`:

```ts
import type {
  CDCompetitionsResponse,
  CDFixtureResponse,
  CDMatchStatsResponse,
  CDFixtureMatch,
  CDPlayerStats,
} from "@/types/champion-data";
import type { MatchStatus } from "@prisma/client";

const BASE_URL =
  process.env.CHAMPION_DATA_BASE_URL || "https://mc.championdata.com/data";

async function fetchFromChampionData<T>(path: string, revalidate = 3600): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { next: { revalidate } });

  if (!res.ok) {
    throw new Error(`Champion Data API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch all available competitions.
 */
export async function fetchCompetitions(): Promise<CDCompetitionsResponse> {
  return fetchFromChampionData<CDCompetitionsResponse>("/competitions.json", 86400);
}

/**
 * Fetch fixture (schedule + results) for a competition.
 */
export async function fetchFixture(compId: number): Promise<CDFixtureResponse> {
  return fetchFromChampionData<CDFixtureResponse>(`/${compId}/fixture.json`, 900);
}

/**
 * Fetch detailed match stats.
 */
export async function fetchMatchStats(
  compId: number,
  matchId: number
): Promise<CDMatchStatsResponse> {
  return fetchFromChampionData<CDMatchStatsResponse>(`/${compId}/${matchId}.json`, 30);
}

// ───── Transform functions ─────

function mapMatchStatus(cdStatus: string): MatchStatus {
  switch (cdStatus) {
    case "Playing":
      return "LIVE";
    case "Complete":
      return "COMPLETED";
    case "Scheduled":
    default:
      return "SCHEDULED";
  }
}

/**
 * Transform a Champion Data fixture match to a Prisma-compatible object.
 * Note: homeTeamId and awayTeamId are returned as champion data IDs
 * and must be resolved to Prisma IDs by the caller.
 */
export function transformFixtureMatch(
  cdMatch: CDFixtureMatch,
  competitionId: string
) {
  return {
    championDataMatchId: cdMatch.matchId,
    round: cdMatch.round,
    venue: cdMatch.venue,
    scheduledAt: new Date(cdMatch.utcStartTime),
    homeScore: cdMatch.homeScore ?? 0,
    awayScore: cdMatch.awayScore ?? 0,
    status: mapMatchStatus(cdMatch.matchStatus),
    competitionId,
    homeChampionDataTeamId: cdMatch.homeSquadId,
    awayChampionDataTeamId: cdMatch.awaySquadId,
  };
}

/**
 * Transform Champion Data player stats to a Prisma-compatible stats object.
 * Note: playerId is returned as championDataPlayerId and must be resolved
 * to a Prisma Player ID by the caller.
 */
export function transformPlayerStats(cdPlayer: CDPlayerStats) {
  return {
    championDataPlayerId: cdPlayer.playerId,
    name: cdPlayer.displayName,
    position: cdPlayer.position,
    goals: cdPlayer.goals,
    attempts: cdPlayer.attempts,
    goalAssists: cdPlayer.goalAssists,
    intercepts: cdPlayer.intercepts,
    deflections: cdPlayer.deflections,
    rebounds: cdPlayer.rebounds,
    penalties: cdPlayer.penalties,
    feeds: cdPlayer.feeds,
    centrePassReceives: cdPlayer.centrePassReceives,
    turnovers: cdPlayer.turnovers,
    minutesPlayed: cdPlayer.minutesPlayed,
  };
}
```

- [ ] **Step 4: Run the tests — all should pass**

```bash
npx vitest run src/lib/__tests__/champion-data.test.ts
# Expected: PASS — all 7 tests pass
# ✓ fetchCompetitions > fetches and returns competitions
# ✓ fetchCompetitions > throws on fetch failure
# ✓ fetchFixture > fetches fixture for a given competition
# ✓ fetchMatchStats > fetches match stats for a given competition and match
# ✓ transformFixtureMatch > transforms CDFixtureMatch to Prisma-compatible format
# ✓ transformFixtureMatch > maps 'Playing' status to LIVE
# ✓ transformFixtureMatch > maps 'Scheduled' status to SCHEDULED
# ✓ transformPlayerStats > transforms CDPlayerStats to Prisma-compatible format
```

- [ ] **Step 5: Commit Champion Data service**

```bash
git add src/types/champion-data.ts src/lib/champion-data.ts src/lib/__tests__/champion-data.test.ts
git commit -m "Add Champion Data service with typed client and transform functions"
```

---

## Task 4: TheSportsDB Service

**Files:**
- Create: `src/types/the-sports-db.ts`
- Create: `src/lib/the-sports-db.ts`
- Test: `src/lib/__tests__/the-sports-db.test.ts`

---

- [ ] **Step 1: Define TypeScript interfaces for TheSportsDB responses**

Create `src/types/the-sports-db.ts`:

```ts
// ───── TheSportsDB API Response types ─────

export interface TSDBTeamsResponse {
  teams: TSDBTeam[] | null;
}

export interface TSDBTeam {
  idTeam: string;
  strTeam: string;
  strTeamShort: string;
  strAlternate: string;
  strLeague: string;
  strBadge: string;     // URL to team badge/logo
  strBanner: string;    // URL to team banner image
  strDescriptionEN: string;
  strCountry: string;
  strStadium: string;
  strTeamJersey: string; // URL to jersey image
  strTeamFanart1: string;
  strTeamFanart2: string;
  strTeamFanart3: string;
}

export interface TSDBPlayersResponse {
  player: TSDBPlayer[] | null;
}

export interface TSDBPlayer {
  idPlayer: string;
  strPlayer: string;
  strPosition: string;
  strNationality: string;
  strThumb: string;     // URL to player photo (thumbnail)
  strCutout: string;    // URL to cutout image
  strRender: string;    // URL to render image
  dateBorn: string;
  strDescriptionEN: string;
  strTeam: string;
}
```

- [ ] **Step 2: Write failing tests for TheSportsDB service**

Create `src/lib/__tests__/the-sports-db.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchTeams,
  fetchPlayersByTeam,
  fetchTeamBadge,
} from "@/lib/the-sports-db";
import type {
  TSDBTeamsResponse,
  TSDBPlayersResponse,
} from "@/types/the-sports-db";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ───── Mock data ─────

const mockTeamsResponse: TSDBTeamsResponse = {
  teams: [
    {
      idTeam: "149291",
      strTeam: "Melbourne Vixens",
      strTeamShort: "VIX",
      strAlternate: "Vixens",
      strLeague: "Suncorp Super Netball",
      strBadge: "https://www.thesportsdb.com/images/media/team/badge/vixens.png",
      strBanner: "https://www.thesportsdb.com/images/media/team/banner/vixens.jpg",
      strDescriptionEN: "The Melbourne Vixens are an Australian netball team.",
      strCountry: "Australia",
      strStadium: "John Cain Arena",
      strTeamJersey: "https://www.thesportsdb.com/images/media/team/jersey/vixens.png",
      strTeamFanart1: "",
      strTeamFanart2: "",
      strTeamFanart3: "",
    },
  ],
};

const mockPlayersResponse: TSDBPlayersResponse = {
  player: [
    {
      idPlayer: "34186452",
      strPlayer: "Mwai Kumwenda",
      strPosition: "Goal Shooter",
      strNationality: "Malawi",
      strThumb: "https://www.thesportsdb.com/images/media/player/thumb/kumwenda.jpg",
      strCutout: "",
      strRender: "",
      dateBorn: "1993-08-22",
      strDescriptionEN: "Malawian netball player.",
      strTeam: "Melbourne Vixens",
    },
  ],
};

// ───── Tests ─────

describe("TheSportsDB Service", () => {
  describe("fetchTeams", () => {
    it("fetches teams for SSN league (id: 4540)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTeamsResponse,
      });

      const result = await fetchTeams();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("lookup_all_teams.php?id=4540"),
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
      expect(result[0].strTeam).toBe("Melbourne Vixens");
    });

    it("returns empty array when API returns null teams", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: null }),
      });

      const result = await fetchTeams();
      expect(result).toEqual([]);
    });

    it("throws on fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });

      await expect(fetchTeams()).rejects.toThrow("TheSportsDB API error: 404 Not Found");
    });
  });

  describe("fetchPlayersByTeam", () => {
    it("fetches players for a given team ID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPlayersResponse,
      });

      const result = await fetchPlayersByTeam("149291");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("lookup_all_players.php?id=149291"),
        expect.any(Object)
      );
      expect(result).toHaveLength(1);
      expect(result[0].strPlayer).toBe("Mwai Kumwenda");
    });

    it("returns empty array when API returns null players", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ player: null }),
      });

      const result = await fetchPlayersByTeam("999999");
      expect(result).toEqual([]);
    });
  });

  describe("fetchTeamBadge", () => {
    it("returns badge URL for a team", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: [{ strBadge: "https://example.com/badge.png" }] }),
      });

      const result = await fetchTeamBadge("149291");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("lookupteam.php?id=149291"),
        expect.any(Object)
      );
      expect(result).toBe("https://example.com/badge.png");
    });

    it("returns null when team not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ teams: null }),
      });

      const result = await fetchTeamBadge("000000");
      expect(result).toBeNull();
    });
  });
});
```

Run the tests:

```bash
npx vitest run src/lib/__tests__/the-sports-db.test.ts
# Expected: FAIL — module @/lib/the-sports-db not found
```

- [ ] **Step 3: Implement the TheSportsDB service**

Create `src/lib/the-sports-db.ts`:

```ts
import type {
  TSDBTeam,
  TSDBTeamsResponse,
  TSDBPlayer,
  TSDBPlayersResponse,
} from "@/types/the-sports-db";

const SSN_LEAGUE_ID = "4540";

function getBaseUrl(): string {
  const apiKey = process.env.THESPORTSDB_API_KEY || "3"; // "3" is the free test key
  return (
    process.env.THESPORTSDB_BASE_URL ||
    `https://www.thesportsdb.com/api/v1/json/${apiKey}`
  );
}

async function fetchFromTSDB<T>(endpoint: string): Promise<T> {
  const url = `${getBaseUrl()}/${endpoint}`;
  const res = await fetch(url, { next: { revalidate: 86400 } });

  if (!res.ok) {
    throw new Error(`TheSportsDB API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Fetch all teams in the Suncorp Super Netball league.
 */
export async function fetchTeams(leagueId = SSN_LEAGUE_ID): Promise<TSDBTeam[]> {
  const data = await fetchFromTSDB<TSDBTeamsResponse>(
    `lookup_all_teams.php?id=${leagueId}`
  );
  return data.teams ?? [];
}

/**
 * Fetch all players for a given team.
 */
export async function fetchPlayersByTeam(teamId: string): Promise<TSDBPlayer[]> {
  const data = await fetchFromTSDB<TSDBPlayersResponse>(
    `lookup_all_players.php?id=${teamId}`
  );
  return data.player ?? [];
}

/**
 * Fetch the badge (logo) URL for a specific team.
 */
export async function fetchTeamBadge(teamId: string): Promise<string | null> {
  const data = await fetchFromTSDB<{ teams: { strBadge: string }[] | null }>(
    `lookupteam.php?id=${teamId}`
  );
  return data.teams?.[0]?.strBadge ?? null;
}
```

- [ ] **Step 4: Run the tests — all should pass**

```bash
npx vitest run src/lib/__tests__/the-sports-db.test.ts
# Expected: PASS — all 6 tests pass
# ✓ fetchTeams > fetches teams for SSN league (id: 4540)
# ✓ fetchTeams > returns empty array when API returns null teams
# ✓ fetchTeams > throws on fetch failure
# ✓ fetchPlayersByTeam > fetches players for a given team ID
# ✓ fetchPlayersByTeam > returns empty array when API returns null players
# ✓ fetchTeamBadge > returns badge URL for a team
# ✓ fetchTeamBadge > returns null when team not found
```

- [ ] **Step 5: Commit TheSportsDB service**

```bash
git add src/types/the-sports-db.ts src/lib/the-sports-db.ts src/lib/__tests__/the-sports-db.test.ts
git commit -m "Add TheSportsDB service for team badges and player photos"
```

- [ ] **Step 6: Run full test suite to verify everything works together**

```bash
npx vitest run
# Expected: PASS — all tests across all files pass
# Test Files: 3 passed
# Tests: ~17 passed
```

---

## Part 2: UI Components & Pages (Tasks 5-11)

---

### Task 5: Design System & AppShell

**Files:**
- Create `src/components/layout/AppShell.tsx`
- Create `src/components/layout/Sidebar.tsx`
- Create `src/components/layout/BottomNav.tsx`
- Modify `src/app/layout.tsx`
- Create `src/components/layout/__tests__/AppShell.test.tsx`
- Create `src/components/layout/__tests__/Sidebar.test.tsx`
- Create `src/components/layout/__tests__/BottomNav.test.tsx`

- [ ] **Step 1: Write AppShell test**

Create `src/components/layout/__tests__/AppShell.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppShell } from '../AppShell';

describe('AppShell', () => {
  it('renders children content', () => {
    render(<AppShell><div data-testid="child">Content</div></AppShell>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders sidebar on desktop', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('renders bottom nav', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders NETPULSE branding', () => {
    render(<AppShell><div>Content</div></AppShell>);
    expect(screen.getByText('NETPULSE')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run AppShell test (expect fail)**

```bash
npx vitest run src/components/layout/__tests__/AppShell.test.tsx
```

- [ ] **Step 3: Implement Sidebar component**

Create `src/components/layout/Sidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/?filter=live', label: 'Live', icon: 'sensors' },
  { href: '/standings', label: 'Standings', icon: 'leaderboard' },
  { href: '/teams', label: 'Teams', icon: 'groups' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex flex-col h-full w-[264px] fixed left-0 top-0 bg-slate-900 py-8 z-40 shadow-xl">
      <div className="px-6 mb-8">
        <span className="text-2xl font-black italic tracking-tighter text-white uppercase font-headline">
          NETPULSE
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 py-3 pl-4 border-l-4 transition-all font-headline font-medium text-sm ${
                isActive
                  ? 'text-lime-400 border-lime-400 bg-slate-800/30'
                  : 'text-slate-400 border-transparent hover:bg-slate-800'
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 4: Implement BottomNav component**

Create `src/components/layout/BottomNav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Fixtures', icon: 'calendar_today' },
  { href: '/?filter=live', label: 'Live', icon: 'sensors' },
  { href: '/standings', label: 'Standings', icon: 'leaderboard' },
  { href: '/teams', label: 'Teams', icon: 'groups' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pb-6 pt-2 bg-slate-950 rounded-t-2xl shadow-[0_-8px_24px_rgba(0,0,0,0.6)] border-t border-slate-800/50">
      {navItems.map((item) => {
        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center py-1 px-4 rounded-xl transition-all ${
              isActive
                ? 'bg-lime-500 text-slate-950 scale-105'
                : 'text-slate-500 hover:bg-slate-800'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            <span className="font-bold font-headline text-[10px] tracking-tight uppercase">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Implement AppShell component**

Create `src/components/layout/AppShell.tsx`:

```tsx
import { Sidebar } from './Sidebar';
import { BottomNav } from './BottomNav';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <Sidebar />
      <main className="lg:ml-[264px] pt-4 pb-24 lg:pb-8 px-4 md:px-8">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 6: Update root layout**

Modify `src/app/layout.tsx` to wrap children with AppShell:

```tsx
import type { Metadata } from 'next';
import { Lexend, Manrope, Inter } from 'next/font/google';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

const lexend = Lexend({
  subsets: ['latin'],
  variable: '--font-headline',
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-label',
});

export const metadata: Metadata = {
  title: 'NETPULSE - Suncorp Super Netball',
  description: 'Live scores, stats, and fixtures for Suncorp Super Netball',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${lexend.variable} ${manrope.variable} ${inter.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Run AppShell tests (expect pass)**

```bash
npx vitest run src/components/layout/__tests__/AppShell.test.tsx
```

- [ ] **Step 8: Commit Task 5**

```bash
git add src/components/layout/ src/app/layout.tsx
git commit -m "feat: add AppShell with responsive sidebar and bottom nav"
```

---

### Task 6: Shared Components

**Files:**
- Create `src/components/ui/ScoreCard.tsx`
- Create `src/components/ui/PlayerStatsTable.tsx`
- Create `src/components/ui/LiveIndicator.tsx`
- Create `src/components/ui/QuarterScoreBar.tsx`
- Create `src/components/ui/TeamBadge.tsx`
- Create `src/components/ui/StatCard.tsx`
- Create `src/components/ui/MatchMomentum.tsx`
- Create `src/components/ui/__tests__/ScoreCard.test.tsx`
- Create `src/components/ui/__tests__/PlayerStatsTable.test.tsx`
- Create `src/components/ui/__tests__/LiveIndicator.test.tsx`
- Create `src/components/ui/__tests__/QuarterScoreBar.test.tsx`
- Create `src/components/ui/__tests__/TeamBadge.test.tsx`
- Create `src/components/ui/__tests__/StatCard.test.tsx`
- Create `src/components/ui/__tests__/MatchMomentum.test.tsx`

- [ ] **Step 1: Write LiveIndicator test**

Create `src/components/ui/__tests__/LiveIndicator.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LiveIndicator } from '../LiveIndicator';

describe('LiveIndicator', () => {
  it('renders LIVE text', () => {
    render(<LiveIndicator />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders pulsing dot', () => {
    const { container } = render(<LiveIndicator />);
    expect(container.querySelector('.animate-ping')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<LiveIndicator className="ml-2" />);
    expect(container.firstChild).toHaveClass('ml-2');
  });
});
```

- [ ] **Step 2: Implement LiveIndicator**

Create `src/components/ui/LiveIndicator.tsx`:

```tsx
interface LiveIndicatorProps {
  className?: string;
}

export function LiveIndicator({ className = '' }: LiveIndicatorProps) {
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
      </span>
      <span className="font-label text-[10px] font-bold uppercase tracking-tighter text-secondary">
        LIVE
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Run LiveIndicator test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/LiveIndicator.test.tsx
```

- [ ] **Step 4: Write TeamBadge test**

Create `src/components/ui/__tests__/TeamBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TeamBadge } from '../TeamBadge';

describe('TeamBadge', () => {
  it('renders team name', () => {
    render(<TeamBadge name="Melbourne Vixens" abbreviation="VIX" />);
    expect(screen.getByText('Melbourne Vixens')).toBeInTheDocument();
  });

  it('renders logo when provided', () => {
    render(<TeamBadge name="Vixens" abbreviation="VIX" logoUrl="/vixens.png" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/vixens.png');
  });

  it('renders abbreviation fallback when no logo', () => {
    render(<TeamBadge name="Vixens" abbreviation="VIX" />);
    expect(screen.getByText('VIX')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Implement TeamBadge**

Create `src/components/ui/TeamBadge.tsx`:

```tsx
import Image from 'next/image';

interface TeamBadgeProps {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: { badge: 'w-8 h-8', text: 'text-xs', name: 'text-xs' },
  md: { badge: 'w-12 h-12', text: 'text-lg', name: 'text-sm' },
  lg: { badge: 'w-16 h-16', text: 'text-xl', name: 'text-base' },
};

export function TeamBadge({ name, abbreviation, logoUrl, size = 'md' }: TeamBadgeProps) {
  const s = sizeClasses[size];

  return (
    <div className="flex items-center gap-3">
      <div className={`${s.badge} rounded-lg bg-primary-container flex items-center justify-center overflow-hidden`}>
        {logoUrl ? (
          <Image src={logoUrl} alt={name} width={48} height={48} className="w-full h-full object-contain" />
        ) : (
          <span className={`${s.text} font-black italic text-white font-headline`}>
            {abbreviation.charAt(0)}
          </span>
        )}
      </div>
      <span className={`${s.name} font-bold font-headline text-primary uppercase`}>{name}</span>
    </div>
  );
}
```

- [ ] **Step 6: Run TeamBadge test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/TeamBadge.test.tsx
```

- [ ] **Step 7: Write ScoreCard test**

Create `src/components/ui/__tests__/ScoreCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ScoreCard } from '../ScoreCard';

const liveMatch = {
  id: '1',
  homeTeam: { name: 'Vixens', abbreviation: 'VIX', logoUrl: null },
  awayTeam: { name: 'Firebirds', abbreviation: 'FIR', logoUrl: null },
  homeScore: 42,
  awayScore: 38,
  status: 'LIVE' as const,
  currentQuarter: 3,
  currentTime: '04:12',
  round: 12,
  venue: 'Arena',
};

const scheduledMatch = {
  ...liveMatch,
  id: '2',
  homeScore: 0,
  awayScore: 0,
  status: 'SCHEDULED' as const,
  currentQuarter: null,
  currentTime: null,
  scheduledAt: '2026-03-25T09:30:00Z',
};

describe('ScoreCard', () => {
  it('renders both team names', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('Vixens')).toBeInTheDocument();
    expect(screen.getByText('Firebirds')).toBeInTheDocument();
  });

  it('renders scores', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('38')).toBeInTheDocument();
  });

  it('shows LIVE indicator for live matches', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('shows quarter info for live matches', () => {
    render(<ScoreCard match={liveMatch} />);
    expect(screen.getByText(/Q3/)).toBeInTheDocument();
  });

  it('does not show LIVE indicator for scheduled matches', () => {
    render(<ScoreCard match={scheduledMatch} />);
    expect(screen.queryByText('LIVE')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Implement ScoreCard**

Create `src/components/ui/ScoreCard.tsx`:

Reference: `fixtures-scores-hub/index.html` live card pattern. White card with `border-l-4 border-secondary` for live, rounded-xl, shadow-sm.

```tsx
import Link from 'next/link';
import { LiveIndicator } from './LiveIndicator';

interface TeamInfo {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
}

interface ScoreCardMatch {
  id: string;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number;
  awayScore: number;
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETED';
  currentQuarter?: number | null;
  currentTime?: string | null;
  round?: number;
  venue?: string;
  scheduledAt?: string;
}

interface ScoreCardProps {
  match: ScoreCardMatch;
}

export function ScoreCard({ match }: ScoreCardProps) {
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';

  return (
    <Link
      href={`/match/${match.id}`}
      className={`block bg-surface-container-lowest rounded-xl p-6 shadow-sm relative overflow-hidden group transition-all hover:shadow-md ${
        isLive ? 'border-l-4 border-secondary' : 'border-l-4 border-transparent'
      }`}
    >
      {/* Status badge */}
      <div className="flex justify-between items-start mb-6">
        {isLive && match.currentQuarter && (
          <span className="bg-primary-container text-on-primary-fixed-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Q{match.currentQuarter} {match.currentTime && `\u2022 ${match.currentTime}`}
          </span>
        )}
        {isCompleted && (
          <span className="bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-[10px] font-bold font-label tracking-widest uppercase">
            Final
          </span>
        )}
        {match.status === 'SCHEDULED' && match.scheduledAt && (
          <span className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
            {new Date(match.scheduledAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {isLive && <LiveIndicator />}
      </div>

      {/* Score display */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col items-center flex-1 text-center">
          <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-white font-black italic text-lg font-headline mb-2">
            {match.homeTeam.abbreviation.charAt(0)}
          </div>
          <span className="text-sm font-bold font-headline text-primary uppercase">
            {match.homeTeam.name}
          </span>
        </div>

        <div className="flex items-center gap-4 text-4xl font-black font-headline text-primary tracking-tighter">
          <span>{match.homeScore}</span>
          <span className="text-outline-variant text-2xl">-</span>
          <span>{match.awayScore}</span>
        </div>

        <div className="flex flex-col items-center flex-1 text-center">
          <div className="w-12 h-12 bg-surface-container-high rounded-lg flex items-center justify-center text-primary font-black italic text-lg font-headline mb-2">
            {match.awayTeam.abbreviation.charAt(0)}
          </div>
          <span className="text-sm font-bold font-headline text-primary uppercase">
            {match.awayTeam.name}
          </span>
        </div>
      </div>

      {/* Footer */}
      {(match.round || match.venue) && (
        <div className="mt-6 pt-4 border-t border-surface-container flex justify-between items-center">
          <span className="text-[10px] font-medium text-on-surface-variant uppercase font-label">
            {match.round && `Round ${match.round}`} {match.venue && `\u2022 ${match.venue}`}
          </span>
          <span className="text-secondary font-bold text-xs flex items-center gap-1 group-hover:gap-2 transition-all">
            View Stats
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </span>
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 9: Run ScoreCard test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/ScoreCard.test.tsx
```

- [ ] **Step 10: Write PlayerStatsTable test**

Create `src/components/ui/__tests__/PlayerStatsTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { PlayerStatsTable } from '../PlayerStatsTable';

const players = [
  {
    id: '1',
    name: 'Elena Rodriguez',
    position: 'GS' as const,
    photoUrl: null,
    goals: 42,
    attempts: 45,
    goalAssists: 0,
    intercepts: 0,
    deflections: 1,
    rebounds: 4,
    penalties: 0,
    feeds: 2,
    centrePassReceives: 0,
    turnovers: 1,
    minutesPlayed: 60,
  },
  {
    id: '2',
    name: 'Tasha Banks',
    position: 'GK' as const,
    photoUrl: null,
    goals: 0,
    attempts: 0,
    goalAssists: 0,
    intercepts: 8,
    deflections: 12,
    rebounds: 9,
    penalties: 2,
    feeds: 0,
    centrePassReceives: 0,
    turnovers: 0,
    minutesPlayed: 60,
  },
];

describe('PlayerStatsTable', () => {
  it('renders team name in header', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText(/THUNDER/i)).toBeInTheDocument();
  });

  it('renders all player names', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
    expect(screen.getByText('Tasha Banks')).toBeInTheDocument();
  });

  it('renders position badges', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('GS')).toBeInTheDocument();
    expect(screen.getByText('GK')).toBeInTheDocument();
  });

  it('renders goal stats', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(<PlayerStatsTable teamName="Thunder" players={players} />);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Inter')).toBeInTheDocument();
    expect(screen.getByText('Reb')).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Implement PlayerStatsTable**

Create `src/components/ui/PlayerStatsTable.tsx`:

Reference: `box-score-player-stats/index.html` table. `kinetic-gradient` header, `surface-container-lowest` card, rows with hover state, position badges in `primary-container`.

```tsx
import type { Position } from '@prisma/client';

interface PlayerStat {
  id: string;
  name: string;
  position: Position;
  photoUrl?: string | null;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centrePassReceives: number;
  turnovers: number;
  minutesPlayed: number;
}

interface PlayerStatsTableProps {
  teamName: string;
  players: PlayerStat[];
}

export function PlayerStatsTable({ teamName, players }: PlayerStatsTableProps) {
  const shootingPct = (goals: number, attempts: number) =>
    attempts > 0 ? Math.round((goals / attempts) * 100) : null;

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
      <div className="bg-primary-container px-6 py-4 flex justify-between items-center">
        <h3 className="text-white font-headline font-bold text-lg tracking-tight uppercase">
          Player Performance - {teamName}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/20">
              <th className="px-6 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest">
                Player Name
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-center">
                Pos
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Goals
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Shots
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Shoot %
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Inter
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Deflect
              </th>
              <th className="px-4 py-4 text-[10px] font-bold font-label text-on-surface-variant uppercase tracking-widest text-right">
                Reb
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {players.map((player) => {
              const pct = shootingPct(player.goals, player.attempts);
              return (
                <tr key={player.id} className="hover:bg-surface-container/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-bold font-headline text-primary-container text-sm">
                      {player.name}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="bg-primary-container text-white text-[10px] font-bold px-1.5 py-0.5 rounded font-label">
                      {player.position}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right font-black font-headline text-primary-container">
                    {player.goals}
                  </td>
                  <td className="px-4 py-4 text-right font-medium text-on-surface-variant">
                    {player.attempts}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {pct !== null ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-bold text-secondary">{pct}%</span>
                        <div className="w-12 bg-surface-container-high h-1 rounded-full overflow-hidden">
                          <div className="bg-secondary h-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="font-bold text-outline">-</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold">
                    {player.intercepts}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold text-on-surface-variant">
                    {player.deflections}
                  </td>
                  <td className="px-4 py-4 text-right font-label font-semibold text-secondary">
                    {player.rebounds}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Run PlayerStatsTable test (expect pass)**

```bash
npx vitest run src/components/ui/__tests__/PlayerStatsTable.test.tsx
```

- [ ] **Step 13: Write QuarterScoreBar test**

Create `src/components/ui/__tests__/QuarterScoreBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QuarterScoreBar } from '../QuarterScoreBar';

const quarters = [
  { quarter: 1, homeScore: 16, awayScore: 14 },
  { quarter: 2, homeScore: 12, awayScore: 18 },
  { quarter: 3, homeScore: 20, awayScore: 12 },
  { quarter: 4, homeScore: 16, awayScore: 14 },
];

describe('QuarterScoreBar', () => {
  it('renders all quarter labels', () => {
    render(<QuarterScoreBar quarters={quarters} />);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('Q4')).toBeInTheDocument();
  });

  it('renders correct number of bars', () => {
    const { container } = render(<QuarterScoreBar quarters={quarters} />);
    const bars = container.querySelectorAll('[data-testid^="quarter-bar-"]');
    expect(bars).toHaveLength(4);
  });
});
```

- [ ] **Step 14: Implement QuarterScoreBar**

Create `src/components/ui/QuarterScoreBar.tsx`:

Reference: `box-score-player-stats/index.html` match momentum bars. `primary-container` for home, `secondary/40` for away.

```tsx
interface Quarter {
  quarter: number;
  homeScore: number;
  awayScore: number;
}

interface QuarterScoreBarProps {
  quarters: Quarter[];
}

export function QuarterScoreBar({ quarters }: QuarterScoreBarProps) {
  return (
    <div className="space-y-4">
      {quarters.map((q) => {
        const total = q.homeScore + q.awayScore;
        const homePct = total > 0 ? (q.homeScore / total) * 100 : 50;
        const awayPct = total > 0 ? (q.awayScore / total) * 100 : 50;

        return (
          <div key={q.quarter} className="flex items-center gap-4" data-testid={`quarter-bar-${q.quarter}`}>
            <span className="text-[10px] font-bold font-label text-on-surface-variant w-8">
              Q{q.quarter}
            </span>
            <div className="flex-1 h-3 flex gap-1">
              <div
                className="bg-primary-container rounded-sm"
                style={{ width: `${homePct}%` }}
              />
              <div
                className="bg-secondary/40 rounded-sm"
                style={{ width: `${awayPct}%` }}
              />
            </div>
            <span className="text-[10px] font-bold font-label text-on-surface-variant w-12 text-right">
              {q.homeScore}-{q.awayScore}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 15: Write and implement StatCard**

Create `src/components/ui/__tests__/StatCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Goals" value="482" />);
    expect(screen.getByText('Total Goals')).toBeInTheDocument();
    expect(screen.getByText('482')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<StatCard label="Shooting" value="93%" subtitle="Season average" />);
    expect(screen.getByText('Season average')).toBeInTheDocument();
  });
});
```

Create `src/components/ui/StatCard.tsx`:

Reference: `box-score-player-stats/index.html` bento stat cards and `league-standings/index.html` featured stats.

```tsx
interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  variant?: 'default' | 'dark';
  icon?: string;
}

export function StatCard({ label, value, subtitle, variant = 'default', icon }: StatCardProps) {
  const isDark = variant === 'dark';

  return (
    <div
      className={`rounded-xl p-6 relative overflow-hidden ${
        isDark
          ? 'bg-primary-container text-white'
          : 'bg-surface-container-low'
      }`}
    >
      {icon && (
        <div className="absolute -right-8 -bottom-8 opacity-10">
          <span className="material-symbols-outlined text-[96px]">{icon}</span>
        </div>
      )}
      <h4
        className={`text-[10px] font-bold font-label uppercase tracking-widest mb-4 ${
          isDark ? 'text-lime-400' : 'text-on-surface-variant'
        }`}
      >
        {label}
      </h4>
      <div className="flex items-end gap-2">
        <span
          className={`text-5xl font-black font-headline ${
            isDark ? 'text-white' : 'text-primary-container'
          }`}
        >
          {value}
        </span>
      </div>
      {subtitle && (
        <p
          className={`text-sm mt-2 font-label ${
            isDark ? 'text-on-primary-container' : 'text-on-surface-variant'
          }`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 16: Write and implement MatchMomentum**

Create `src/components/ui/__tests__/MatchMomentum.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MatchMomentum } from '../MatchMomentum';

const scoreFlow = [
  { period: 1, homeScore: 1, awayScore: 0 },
  { period: 1, homeScore: 2, awayScore: 1 },
  { period: 1, homeScore: 3, awayScore: 2 },
];

describe('MatchMomentum', () => {
  it('renders heading', () => {
    render(<MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />);
    expect(screen.getByText('Match Momentum')).toBeInTheDocument();
  });

  it('renders SVG chart', () => {
    const { container } = render(
      <MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders team legend', () => {
    render(<MatchMomentum scoreFlow={scoreFlow} homeTeam="Thunder" awayTeam="Lightning" />);
    expect(screen.getByText('Thunder')).toBeInTheDocument();
    expect(screen.getByText('Lightning')).toBeInTheDocument();
  });
});
```

Create `src/components/ui/MatchMomentum.tsx`:

Simple SVG line chart showing score flow over time. Two polylines (home/away) on an SVG canvas.

```tsx
interface ScoreFlowPoint {
  period: number;
  homeScore: number;
  awayScore: number;
}

interface MatchMomentumProps {
  scoreFlow: ScoreFlowPoint[];
  homeTeam: string;
  awayTeam: string;
}

export function MatchMomentum({ scoreFlow, homeTeam, awayTeam }: MatchMomentumProps) {
  if (scoreFlow.length === 0) return null;

  const width = 400;
  const height = 160;
  const padding = 20;

  const maxScore = Math.max(
    ...scoreFlow.map((p) => Math.max(p.homeScore, p.awayScore)),
    1
  );

  const toX = (i: number) =>
    padding + (i / Math.max(scoreFlow.length - 1, 1)) * (width - padding * 2);
  const toY = (score: number) =>
    height - padding - (score / maxScore) * (height - padding * 2);

  const homeLine = scoreFlow.map((p, i) => `${toX(i)},${toY(p.homeScore)}`).join(' ');
  const awayLine = scoreFlow.map((p, i) => `${toX(i)},${toY(p.awayScore)}`).join(' ');

  return (
    <div className="bg-surface-container-low rounded-xl p-6">
      <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-6">
        Match Momentum
      </h4>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <polyline
          points={homeLine}
          fill="none"
          stroke="#001f3f"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={awayLine}
          fill="none"
          stroke="#006e0a"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="6 3"
        />
      </svg>
      <div className="flex gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-primary-container" />
          <span className="text-[10px] font-bold font-label text-on-surface-variant uppercase">
            {homeTeam}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-secondary border-dashed" />
          <span className="text-[10px] font-bold font-label text-on-surface-variant uppercase">
            {awayTeam}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 17: Run all shared component tests**

```bash
npx vitest run src/components/ui/__tests__/
```

- [ ] **Step 18: Commit Task 6**

```bash
git add src/components/ui/
git commit -m "feat: add shared UI components (ScoreCard, PlayerStatsTable, LiveIndicator, etc.)"
```

---

### Task 7: Fixtures & Scores Hub (Homepage `/`)

**Files:**
- Create `src/app/page.tsx`
- Create `src/app/__tests__/page.test.tsx`

- [ ] **Step 1: Write homepage test**

Create `src/app/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HomePage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: '1',
          status: 'LIVE',
          homeScore: 42,
          awayScore: 38,
          currentQuarter: 3,
          currentTime: '04:12',
          round: 12,
          venue: 'Arena',
          scheduledAt: new Date(),
          homeTeam: { name: 'Marlins', abbreviation: 'MAR', logoUrl: null },
          awayTeam: { name: 'Inferno', abbreviation: 'INF', logoUrl: null },
        },
        {
          id: '2',
          status: 'SCHEDULED',
          homeScore: 0,
          awayScore: 0,
          currentQuarter: null,
          currentTime: null,
          round: 12,
          venue: 'Stadium',
          scheduledAt: new Date(Date.now() + 86400000),
          homeTeam: { name: 'Wolves', abbreviation: 'WOL', logoUrl: null },
          awayTeam: { name: 'Harbor', abbreviation: 'HAR', logoUrl: null },
        },
      ]),
    },
  },
}));

describe('HomePage', () => {
  it('renders TODAY\'S PULSE heading', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText("TODAY'S PULSE")).toBeInTheDocument();
  });

  it('renders LIVE ACTION section when live matches exist', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('LIVE ACTION')).toBeInTheDocument();
  });

  it('renders UPCOMING FIXTURES section', async () => {
    const page = await HomePage();
    render(page);
    expect(screen.getByText('UPCOMING FIXTURES')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run homepage test (expect fail)**

```bash
npx vitest run src/app/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement homepage**

Create `src/app/page.tsx`:

Reference: `fixtures-scores-hub/index.html`. Hero header with "TODAY'S PULSE", live action cards grid, upcoming fixtures with featured "Match of the Day" kinetic-gradient card.

```tsx
import { prisma } from '@/lib/db';
import { ScoreCard } from '@/components/ui/ScoreCard';
import Link from 'next/link';

export default async function HomePage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const matches = await prisma.match.findMany({
    where: {
      scheduledAt: { gte: today, lt: tomorrow },
    },
    include: {
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const liveMatches = matches.filter((m) => m.status === 'LIVE');
  const upcomingMatches = matches.filter((m) => m.status === 'SCHEDULED');
  const completedMatches = matches.filter((m) => m.status === 'COMPLETED');
  const featured = upcomingMatches[0];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Hero Header */}
      <section className="mb-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <span className="text-secondary font-bold font-label text-sm uppercase tracking-widest">
              Game Day Hub
            </span>
            <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary mt-2">
              TODAY&apos;S PULSE
            </h1>
          </div>
        </div>
      </section>

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <section className="mb-16">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-3 h-3 rounded-full bg-secondary animate-pulse" />
            <h2 className="text-xl font-bold font-headline text-primary">LIVE ACTION</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {liveMatches.map((match) => (
              <ScoreCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Fixtures */}
      <section className="mb-20">
        <h2 className="text-xl font-bold font-headline text-primary mb-6">UPCOMING FIXTURES</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Featured Match */}
          {featured && (
            <Link
              href={`/match/${featured.id}`}
              className="md:col-span-2 bg-gradient-to-br from-primary to-primary-container rounded-2xl p-8 text-white flex flex-col justify-between min-h-[300px] shadow-2xl"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-lime-400 font-black font-label text-xs uppercase tracking-widest">
                    Match of the Day
                  </span>
                  <h3 className="text-3xl font-black font-headline tracking-tighter italic uppercase">
                    {featured.homeTeam.name} vs {featured.awayTeam.name}
                  </h3>
                </div>
                <div className="text-right">
                  <span className="block text-2xl font-bold font-headline">
                    {new Date(featured.scheduledAt).toLocaleTimeString('en-AU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {featured.venue && (
                    <span className="text-[10px] uppercase font-label text-slate-400">
                      {featured.venue}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-around py-8">
                <div className="text-center">
                  <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
                    <span className="text-3xl font-black italic font-headline">
                      {featured.homeTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <span className="font-bold font-headline uppercase">
                    {featured.homeTeam.name}
                  </span>
                </div>
                <div className="text-lime-400 font-black text-4xl italic px-4">VS</div>
                <div className="text-center">
                  <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center backdrop-blur-md mb-3">
                    <span className="text-3xl font-black italic font-headline">
                      {featured.awayTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <span className="font-bold font-headline uppercase">
                    {featured.awayTeam.name}
                  </span>
                </div>
              </div>
            </Link>
          )}

          {/* Side Fixtures */}
          <div className="flex flex-col gap-4">
            {upcomingMatches.slice(featured ? 1 : 0, 4).map((match) => (
              <Link
                key={match.id}
                href={`/match/${match.id}`}
                className="bg-surface-container rounded-xl p-4 flex items-center justify-between group hover:bg-surface-container-high transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
                    <span className="font-black italic text-primary font-headline">
                      {match.homeTeam.abbreviation.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-on-surface-variant uppercase font-label">
                      {new Date(match.scheduledAt).toLocaleTimeString('en-AU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="text-sm font-bold font-headline text-primary">
                      {match.homeTeam.abbreviation} v {match.awayTeam.abbreviation}
                    </div>
                  </div>
                </div>
                <span className="material-symbols-outlined text-outline-variant group-hover:text-primary transition-colors">
                  calendar_today
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Completed */}
      {completedMatches.length > 0 && (
        <section className="mb-16">
          <h2 className="text-xl font-bold font-headline text-primary mb-6">RESULTS</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {completedMatches.map((match) => (
              <ScoreCard key={match.id} match={match} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run homepage test (expect pass)**

```bash
npx vitest run src/app/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 7**

```bash
git add src/app/page.tsx src/app/__tests__/page.test.tsx
git commit -m "feat: add fixtures & scores hub homepage"
```

---

### Task 8: Box Score Page (`/match/[matchId]`)

**Files:**
- Create `src/app/match/[matchId]/page.tsx`
- Create `src/app/match/[matchId]/__tests__/page.test.tsx`

- [ ] **Step 1: Write box score page test**

Create `src/app/match/[matchId]/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MatchPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: vi.fn().mockResolvedValue({
        id: '1',
        status: 'COMPLETED',
        homeScore: 64,
        awayScore: 58,
        currentQuarter: null,
        currentTime: null,
        round: 12,
        venue: 'Stadium Arena',
        scheduledAt: new Date(),
        homeTeam: { name: 'Thunder', abbreviation: 'THU', logoUrl: null, slug: 'thunder' },
        awayTeam: { name: 'Lightning', abbreviation: 'LIG', logoUrl: null, slug: 'lightning' },
        quarters: [
          { quarter: 1, homeScore: 16, awayScore: 14 },
          { quarter: 2, homeScore: 12, awayScore: 18 },
          { quarter: 3, homeScore: 20, awayScore: 12 },
          { quarter: 4, homeScore: 16, awayScore: 14 },
        ],
        playerStats: [
          {
            id: 'ps1',
            player: { id: 'p1', name: 'Elena Rodriguez', position: 'GS', photoUrl: null, teamId: 'home' },
            goals: 42, attempts: 45, goalAssists: 0, intercepts: 0,
            deflections: 1, rebounds: 4, penalties: 0, feeds: 2,
            centrePassReceives: 0, turnovers: 1, minutesPlayed: 60,
          },
        ],
        scoreFlow: [
          { period: 1, homeScore: 1, awayScore: 0 },
          { period: 1, homeScore: 2, awayScore: 1 },
        ],
      }),
    },
  },
}));

describe('MatchPage', () => {
  it('renders team names in hero', async () => {
    const page = await MatchPage({ params: { matchId: '1' } });
    render(page);
    expect(screen.getByText(/THUNDER/)).toBeInTheDocument();
    expect(screen.getByText(/LIGHTNING/)).toBeInTheDocument();
  });

  it('renders final score', async () => {
    const page = await MatchPage({ params: { matchId: '1' } });
    render(page);
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
  });

  it('renders player stats table', async () => {
    const page = await MatchPage({ params: { matchId: '1' } });
    render(page);
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/match/[matchId]/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement box score page**

Create `src/app/match/[matchId]/page.tsx`:

Reference: `box-score-player-stats/index.html`. Hero header with team names and final score, 4-column grid (3+1 sidebar), player stats table, bento stat cards, MVP card, quarter score bars.

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PlayerStatsTable } from '@/components/ui/PlayerStatsTable';
import { QuarterScoreBar } from '@/components/ui/QuarterScoreBar';
import { MatchMomentum } from '@/components/ui/MatchMomentum';
import { LiveIndicator } from '@/components/ui/LiveIndicator';

interface MatchPageProps {
  params: { matchId: string };
}

export default async function MatchPage({ params }: MatchPageProps) {
  const match = await prisma.match.findUnique({
    where: { id: params.matchId },
    include: {
      homeTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      awayTeam: { select: { name: true, abbreviation: true, logoUrl: true, slug: true } },
      quarters: { orderBy: { quarter: 'asc' } },
      playerStats: {
        include: { player: true },
        orderBy: { goals: 'desc' },
      },
      scoreFlow: { orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }] },
    },
  });

  if (!match) notFound();

  const homePlayerStats = match.playerStats.filter(
    (ps) => ps.player.teamId === match.homeTeamId
  );
  const awayPlayerStats = match.playerStats.filter(
    (ps) => ps.player.teamId === match.awayTeamId
  );

  // Find MVP: highest goals among shooters, or highest intercepts among defenders
  const mvp = match.playerStats.length > 0 ? match.playerStats[0] : null;

  const isLive = match.status === 'LIVE';

  return (
    <div className="max-w-7xl mx-auto">
      {/* Hero Header */}
      <section className="mb-12">
        <div className="flex flex-col md:flex-row justify-between items-end gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              {isLive && <LiveIndicator />}
              <span className="text-on-surface-variant text-xs font-semibold font-label tracking-widest uppercase">
                Round {match.round} {match.venue && `\u2022 ${match.venue}`}
              </span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary-container leading-none uppercase">
              {match.homeTeam.name} vs{' '}
              <span className="text-secondary">{match.awayTeam.name}</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 md:gap-8">
            <div className="text-right">
              <p className="text-xs font-bold font-label text-on-surface-variant uppercase tracking-widest">
                {isLive ? `Q${match.currentQuarter}` : 'Final Score'}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-4xl font-black font-headline text-primary-container">
                  {match.homeScore}
                </span>
                <span className="text-2xl font-bold text-outline-variant">-</span>
                <span className="text-4xl font-black font-headline text-secondary">
                  {match.awayScore}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        {/* Left Column: Tables */}
        <div className="xl:col-span-3 space-y-8">
          <PlayerStatsTable
            teamName={match.homeTeam.name}
            players={homePlayerStats.map((ps) => ({
              id: ps.id,
              name: ps.player.name,
              position: ps.player.position,
              photoUrl: ps.player.photoUrl,
              goals: ps.goals,
              attempts: ps.attempts,
              goalAssists: ps.goalAssists,
              intercepts: ps.intercepts,
              deflections: ps.deflections,
              rebounds: ps.rebounds,
              penalties: ps.penalties,
              feeds: ps.feeds,
              centrePassReceives: ps.centrePassReceives,
              turnovers: ps.turnovers,
              minutesPlayed: ps.minutesPlayed,
            }))}
          />

          <PlayerStatsTable
            teamName={match.awayTeam.name}
            players={awayPlayerStats.map((ps) => ({
              id: ps.id,
              name: ps.player.name,
              position: ps.player.position,
              photoUrl: ps.player.photoUrl,
              goals: ps.goals,
              attempts: ps.attempts,
              goalAssists: ps.goalAssists,
              intercepts: ps.intercepts,
              deflections: ps.deflections,
              rebounds: ps.rebounds,
              penalties: ps.penalties,
              feeds: ps.feeds,
              centrePassReceives: ps.centrePassReceives,
              turnovers: ps.turnovers,
              minutesPlayed: ps.minutesPlayed,
            }))}
          />
        </div>

        {/* Right Column: Sidebar */}
        <div className="space-y-6">
          {/* MVP Card */}
          {mvp && (
            <div className="bg-surface-container-highest rounded-xl p-6 border-l-4 border-secondary">
              <div className="flex justify-between items-start mb-6">
                <span className="bg-secondary text-white text-[10px] font-black px-2 py-1 rounded font-label uppercase tracking-tighter">
                  Match MVP
                </span>
                <span
                  className="material-symbols-outlined text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  star
                </span>
              </div>
              <div className="flex flex-col items-center text-center">
                <h3 className="font-headline text-xl font-black text-primary-container uppercase">
                  {mvp.player.name}
                </h3>
                <p className="font-label text-xs text-on-surface-variant font-bold uppercase tracking-widest mt-1">
                  {mvp.player.position}
                </p>
                <div className="grid grid-cols-2 w-full gap-4 mt-8">
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                      Goals
                    </span>
                    <span className="text-2xl font-black font-headline text-secondary">
                      {mvp.goals}
                    </span>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <span className="block text-[10px] font-label font-bold text-on-surface-variant uppercase tracking-widest">
                      Reb
                    </span>
                    <span className="text-2xl font-black font-headline text-primary-container">
                      {mvp.rebounds}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quarter Score Bars */}
          {match.quarters.length > 0 && (
            <div className="bg-surface-container-low rounded-xl p-6">
              <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight mb-6">
                Quarter Breakdown
              </h4>
              <QuarterScoreBar quarters={match.quarters} />
            </div>
          )}

          {/* Match Momentum */}
          {match.scoreFlow.length > 0 && (
            <MatchMomentum
              scoreFlow={match.scoreFlow}
              homeTeam={match.homeTeam.name}
              awayTeam={match.awayTeam.name}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/match/[matchId]/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 8**

```bash
git add src/app/match/
git commit -m "feat: add box score page with player stats and match momentum"
```

---

### Task 9: League Standings (`/standings`)

**Files:**
- Create `src/app/standings/page.tsx`
- Create `src/app/standings/__tests__/page.test.tsx`

- [ ] **Step 1: Write standings page test**

Create `src/app/standings/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StandingsPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    standing: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: '1',
          rank: 1,
          played: 12,
          wins: 11,
          losses: 1,
          draws: 0,
          goalsFor: 645,
          goalsAgainst: 412,
          goalPercentage: 156.5,
          points: 44,
          team: { name: 'Vipers Athletics', slug: 'vipers-athletics', abbreviation: 'VIP', logoUrl: null },
        },
        {
          id: '2',
          rank: 2,
          played: 12,
          wins: 10,
          losses: 2,
          draws: 0,
          goalsFor: 598,
          goalsAgainst: 480,
          goalPercentage: 124.5,
          points: 40,
          team: { name: 'Starlight Gems', slug: 'starlight-gems', abbreviation: 'STA', logoUrl: null },
        },
      ]),
    },
  },
}));

describe('StandingsPage', () => {
  it('renders standings heading', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText(/Standings/i)).toBeInTheDocument();
  });

  it('renders team names', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('Vipers Athletics')).toBeInTheDocument();
    expect(screen.getByText('Starlight Gems')).toBeInTheDocument();
  });

  it('renders column headers', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('GP')).toBeInTheDocument();
    expect(screen.getByText('Pts')).toBeInTheDocument();
  });

  it('renders points values', async () => {
    const page = await StandingsPage();
    render(page);
    expect(screen.getByText('44')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/standings/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement standings page**

Create `src/app/standings/page.tsx`:

Reference: `league-standings/index.html`. Kinetic-gradient table header, rank column with green left border for top teams, bento featured stats below.

```tsx
import { prisma } from '@/lib/db';
import Link from 'next/link';

export default async function StandingsPage() {
  const standings = await prisma.standing.findMany({
    include: {
      team: { select: { name: true, slug: true, abbreviation: true, logoUrl: true } },
    },
    orderBy: { rank: 'asc' },
  });

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <section className="mb-12 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <span className="inline-flex items-center gap-2 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-xs font-bold font-label uppercase tracking-widest mb-4">
            <span className="w-2 h-2 bg-secondary rounded-full animate-pulse" />
            Season 2026
          </span>
          <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary uppercase leading-none">
            League <span className="text-on-tertiary-container">Standings</span>
          </h1>
        </div>
      </section>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-2xl mb-8">
        <div className="bg-gradient-to-br from-primary to-primary-container p-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-secondary-fixed">leaderboard</span>
            <h3 className="text-white font-headline font-bold text-lg uppercase tracking-tight">
              Current Rankings
            </h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant">
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest">Rank</th>
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest">Team</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GP</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">W</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">L</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">D</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GF</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">GA</th>
                <th className="py-5 px-4 font-label text-xs font-bold uppercase tracking-widest text-center">G%</th>
                <th className="py-5 px-6 font-label text-xs font-bold uppercase tracking-widest text-right">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {standings.map((s) => {
                const isTop = s.rank <= 2;
                return (
                  <tr key={s.id} className="group hover:bg-surface transition-colors relative">
                    <td className="py-6 px-6 relative">
                      {isTop && (
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.rank === 1 ? 'bg-secondary shadow-[0_0_12px_rgba(0,110,10,0.5)]' : 'bg-secondary/60'}`} />
                      )}
                      <span className="text-2xl font-black font-headline text-primary">
                        {String(s.rank).padStart(2, '0')}
                      </span>
                    </td>
                    <td className="py-6 px-6">
                      <Link href={`/team/${s.team.slug}`} className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary-container rounded-lg flex items-center justify-center text-white font-black text-xl italic font-headline shadow-inner">
                          {s.team.abbreviation.charAt(0)}
                        </div>
                        <div className="font-headline font-bold text-primary text-lg leading-tight">
                          {s.team.name}
                        </div>
                      </Link>
                    </td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-primary">{s.played}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-secondary">{s.wins}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-error">{s.losses}</td>
                    <td className="py-6 px-4 text-center font-bold font-headline text-on-surface-variant">{s.draws}</td>
                    <td className="py-6 px-4 text-center font-label text-primary">{s.goalsFor}</td>
                    <td className="py-6 px-4 text-center font-label text-primary">{s.goalsAgainst}</td>
                    <td className="py-6 px-4 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-bold font-headline ${isTop ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}`}>
                        {s.goalPercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-6 px-6 text-right font-black font-headline text-2xl text-primary tracking-tighter">
                      {s.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/standings/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 9**

```bash
git add src/app/standings/
git commit -m "feat: add league standings page with rankings table"
```

---

### Task 10: Team Profile (`/team/[teamSlug]`)

**Files:**
- Create `src/app/team/[teamSlug]/page.tsx`
- Create `src/app/team/[teamSlug]/__tests__/page.test.tsx`

- [ ] **Step 1: Write team profile test**

Create `src/app/team/[teamSlug]/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    team: {
      findUnique: vi.fn().mockResolvedValue({
        id: 't1',
        name: 'Vipers Athletics',
        slug: 'vipers-athletics',
        abbreviation: 'VIP',
        logoUrl: null,
        players: [
          { id: 'p1', name: 'Maya Sterling', position: 'GS', photoUrl: null },
          { id: 'p2', name: 'Elena Rodriguez', position: 'GA', photoUrl: null },
        ],
        standings: [
          { rank: 1, played: 12, wins: 11, losses: 1, draws: 0, goalsFor: 645, goalsAgainst: 412, goalPercentage: 156.5, points: 44 },
        ],
        homeMatches: [
          { id: 'm1', status: 'COMPLETED', homeScore: 62, awayScore: 44, scheduledAt: new Date(), round: 10, venue: 'Arena', awayTeam: { name: 'Titans', abbreviation: 'TIT' } },
        ],
        awayMatches: [],
      }),
    },
  },
}));

describe('TeamPage', () => {
  it('renders team name', async () => {
    const page = await TeamPage({ params: { teamSlug: 'vipers-athletics' } });
    render(page);
    expect(screen.getByText(/VIPERS/)).toBeInTheDocument();
  });

  it('renders roster', async () => {
    const page = await TeamPage({ params: { teamSlug: 'vipers-athletics' } });
    render(page);
    expect(screen.getByText('Maya Sterling')).toBeInTheDocument();
    expect(screen.getByText('Elena Rodriguez')).toBeInTheDocument();
  });

  it('renders ranking badge', async () => {
    const page = await TeamPage({ params: { teamSlug: 'vipers-athletics' } });
    render(page);
    expect(screen.getByText(/Ranking #1/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/team/[teamSlug]/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement team profile page**

Create `src/app/team/[teamSlug]/page.tsx`:

Reference: `team-profile-vipers/index.html`. Kinetic-gradient hero with team badge, stats grid, recent form horizontal scroll, roster table, upcoming fixtures sidebar.

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import Link from 'next/link';

interface TeamPageProps {
  params: { teamSlug: string };
}

export default async function TeamPage({ params }: TeamPageProps) {
  const team = await prisma.team.findUnique({
    where: { slug: params.teamSlug },
    include: {
      players: { orderBy: { name: 'asc' } },
      standings: { take: 1 },
      homeMatches: {
        include: { awayTeam: { select: { name: true, abbreviation: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
      awayMatches: {
        include: { homeTeam: { select: { name: true, abbreviation: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!team) notFound();

  const standing = team.standings[0];
  const allMatches = [
    ...team.homeMatches.map((m) => ({ ...m, opponent: m.awayTeam.name, isHome: true })),
    ...team.awayMatches.map((m) => ({ ...m, opponent: m.homeTeam.name, isHome: false })),
  ].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  const recentResults = allMatches.filter((m) => m.status === 'COMPLETED').slice(0, 5);
  const upcoming = allMatches.filter((m) => m.status === 'SCHEDULED').slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary to-primary-container rounded-xl overflow-hidden relative min-h-[400px] flex items-center p-8 md:p-12 text-white shadow-2xl">
        <div className="relative z-10 w-full grid md:grid-cols-2 gap-12 items-center">
          <div className="flex items-center gap-8">
            <div className="w-32 h-32 md:w-48 md:h-48 bg-white/10 backdrop-blur-xl border-4 border-lime-400 rounded-full flex items-center justify-center transform -rotate-12 shadow-inner">
              <span className="font-headline font-black text-7xl md:text-9xl text-lime-400 italic tracking-tighter">
                {team.abbreviation.charAt(0)}
              </span>
            </div>
            <div>
              {standing && (
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-secondary text-white font-label text-xs font-bold tracking-widest uppercase mb-4">
                  League Ranking #{standing.rank}
                </div>
              )}
              <h1 className="font-headline font-black text-5xl md:text-7xl italic leading-none mb-4 uppercase">
                {team.name.split(' ').map((word, i) => (
                  <span key={i}>
                    {word}
                    {i < team.name.split(' ').length - 1 && <br />}
                  </span>
                ))}
              </h1>
            </div>
          </div>
          {standing && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Record</span>
                <span className="font-headline font-bold text-4xl text-white">
                  {standing.wins}-{standing.losses}-{standing.draws}
                </span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Points</span>
                <span className="font-headline font-bold text-4xl text-lime-400">{standing.points}</span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goal %</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalPercentage.toFixed(1)}%</span>
              </div>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border-l-4 border-lime-400">
                <span className="font-label text-slate-400 text-sm uppercase tracking-widest block mb-2">Goals For</span>
                <span className="font-headline font-bold text-4xl text-white">{standing.goalsFor}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent Form */}
      {recentResults.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-headline font-bold text-2xl text-primary flex items-center gap-3">
            <span className="w-1 h-8 bg-secondary rounded-full" />
            Recent Form
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {recentResults.map((m) => {
              const teamScore = m.isHome ? m.homeScore : m.awayScore;
              const oppScore = m.isHome ? m.awayScore : m.homeScore;
              const won = teamScore > oppScore;
              return (
                <Link
                  key={m.id}
                  href={`/match/${m.id}`}
                  className={`flex-shrink-0 flex items-center gap-3 px-6 py-4 bg-surface-container-lowest rounded-xl shadow-sm border-b-2 ${
                    won ? 'border-secondary' : 'border-error'
                  }`}
                >
                  <span className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${won ? 'bg-secondary' : 'bg-error'}`}>
                    {won ? 'W' : 'L'}
                  </span>
                  <div>
                    <p className="font-headline font-bold text-sm">vs {m.opponent}</p>
                    <p className="font-label text-xs text-on-surface-variant">{teamScore} - {oppScore}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Roster + Upcoming */}
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Full Roster</h2>
          <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-high border-b border-outline-variant">
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Player</th>
                  <th className="p-4 font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">Pos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {team.players.map((player) => (
                  <tr key={player.id} className="hover:bg-surface-container-low transition-colors">
                    <td className="p-4">
                      <p className="font-body font-bold text-primary">{player.name}</p>
                    </td>
                    <td className="p-4">
                      <span className="bg-primary-container text-on-primary-fixed-variant px-2 py-1 rounded text-xs font-black font-label">
                        {player.position}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-6">
          <h2 className="font-headline font-bold text-2xl text-primary">Upcoming Fixtures</h2>
          <div className="space-y-4">
            {upcoming.map((m) => (
              <Link
                key={m.id}
                href={`/match/${m.id}`}
                className="block bg-surface-container-lowest p-5 rounded-xl border-l-4 border-secondary shadow-sm"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-label text-xs font-black text-secondary uppercase tracking-widest">
                      {m.isHome ? 'Home' : 'Away'}
                    </p>
                    <p className="font-headline font-bold text-lg mt-1">vs {m.opponent}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-label text-xs font-bold text-on-surface-variant">
                      {new Date(m.scheduledAt).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="font-body font-black text-primary">
                      {new Date(m.scheduledAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/team/[teamSlug]/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 10**

```bash
git add src/app/team/
git commit -m "feat: add team profile page with hero, roster, and recent form"
```

---

### Task 11: Teams Directory (`/teams`)

**Files:**
- Create `src/app/teams/page.tsx`
- Create `src/app/teams/__tests__/page.test.tsx`

- [ ] **Step 1: Write teams directory test**

Create `src/app/teams/__tests__/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamsPage from '../page';

vi.mock('@/lib/db', () => ({
  prisma: {
    team: {
      findMany: vi.fn().mockResolvedValue([
        { id: '1', name: 'Melbourne Vixens', slug: 'melbourne-vixens', abbreviation: 'VIX', logoUrl: null, primaryColor: '#FF0090' },
        { id: '2', name: 'West Coast Fever', slug: 'west-coast-fever', abbreviation: 'FEV', logoUrl: null, primaryColor: '#00B140' },
        { id: '3', name: 'Queensland Firebirds', slug: 'queensland-firebirds', abbreviation: 'FIR', logoUrl: null, primaryColor: '#FF6B00' },
      ]),
    },
  },
}));

describe('TeamsPage', () => {
  it('renders heading', async () => {
    const page = await TeamsPage();
    render(page);
    expect(screen.getByText(/Teams/i)).toBeInTheDocument();
  });

  it('renders all team names', async () => {
    const page = await TeamsPage();
    render(page);
    expect(screen.getByText('Melbourne Vixens')).toBeInTheDocument();
    expect(screen.getByText('West Coast Fever')).toBeInTheDocument();
    expect(screen.getByText('Queensland Firebirds')).toBeInTheDocument();
  });

  it('renders team cards as links', async () => {
    const page = await TeamsPage();
    render(page);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href') === '/team/melbourne-vixens')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npx vitest run src/app/teams/__tests__/page.test.tsx
```

- [ ] **Step 3: Implement teams directory page**

Create `src/app/teams/page.tsx`:

Simple grid of team cards linking to `/team/[slug]`. No Stitch design reference; use the same card styling patterns (surface-container-lowest, rounded-xl, shadow-sm).

```tsx
import { prisma } from '@/lib/db';
import Link from 'next/link';

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      abbreviation: true,
      logoUrl: true,
      primaryColor: true,
    },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="max-w-7xl mx-auto">
      <section className="mb-12">
        <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter text-primary uppercase">
          Teams
        </h1>
        <p className="text-on-surface-variant font-body mt-2">
          Suncorp Super Netball teams
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {teams.map((team) => (
          <Link
            key={team.id}
            href={`/team/${team.slug}`}
            className="bg-surface-container-lowest rounded-xl p-6 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-primary-container flex items-center justify-center">
                {team.logoUrl ? (
                  <img src={team.logoUrl} alt={team.name} className="w-14 h-14 object-contain" />
                ) : (
                  <span className="text-4xl font-black italic text-white font-headline">
                    {team.abbreviation.charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <h2 className="font-headline font-bold text-lg text-primary group-hover:text-secondary transition-colors">
                  {team.name}
                </h2>
                <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest mt-1">
                  {team.abbreviation}
                </p>
              </div>
              <span className="material-symbols-outlined text-outline-variant group-hover:text-secondary transition-colors">
                chevron_right
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npx vitest run src/app/teams/__tests__/page.test.tsx
```

- [ ] **Step 5: Commit Task 11**

```bash
git add src/app/teams/
git commit -m "feat: add teams directory page with team card grid"
```

---

## Part 3: Features, Real-Time & Deployment (Tasks 12-17)

---

### Task 12: Authentication (NextAuth.js)

**Files:**
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/lib/auth.ts`
- Create: `src/app/auth/signin/page.tsx`
- Create: `src/app/auth/signup/page.tsx`
- Create: `src/components/auth/AuthButton.tsx`
- Create: `src/middleware.ts`
- Create: `src/types/next-auth.d.ts`
- Test: `src/__tests__/auth/auth.test.ts`
- Test: `src/__tests__/auth/middleware.test.ts`

**Environment variables** (add to `.env.local`):
```
NEXTAUTH_SECRET=<random-32-char-string>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
```

- [ ] **Step 1: Write auth config tests**

Create `src/__tests__/auth/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock bcryptjs
vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

describe('Auth Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export authOptions with credentials and google providers', async () => {
    const { authOptions } = await import('@/lib/auth');
    expect(authOptions).toBeDefined();
    expect(authOptions.providers).toHaveLength(2);
  });

  it('should have session strategy set to jwt', async () => {
    const { authOptions } = await import('@/lib/auth');
    expect(authOptions.session?.strategy).toBe('jwt');
  });

  it('should have custom sign-in page configured', async () => {
    const { authOptions } = await import('@/lib/auth');
    expect(authOptions.pages?.signIn).toBe('/auth/signin');
  });

  it('credentials provider should reject empty email', async () => {
    const { authOptions } = await import('@/lib/auth');
    const credentialsProvider = authOptions.providers.find(
      (p: any) => p.id === 'credentials'
    ) as any;
    const result = await credentialsProvider.options.authorize(
      { email: '', password: 'test123' },
      {} as any
    );
    expect(result).toBeNull();
  });

  it('credentials provider should reject wrong password', async () => {
    const { prisma } = await import('@/lib/db');
    const bcrypt = (await import('bcryptjs')).default;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: '1',
      email: 'test@example.com',
      passwordHash: 'hashed',
    });
    (bcrypt.compare as any).mockResolvedValue(false);

    const { authOptions } = await import('@/lib/auth');
    const credentialsProvider = authOptions.providers.find(
      (p: any) => p.id === 'credentials'
    ) as any;
    const result = await credentialsProvider.options.authorize(
      { email: 'test@example.com', password: 'wrong' },
      {} as any
    );
    expect(result).toBeNull();
  });

  it('credentials provider should return user on valid login', async () => {
    const { prisma } = await import('@/lib/db');
    const bcrypt = (await import('bcryptjs')).default;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
      passwordHash: 'hashed',
    });
    (bcrypt.compare as any).mockResolvedValue(true);

    const { authOptions } = await import('@/lib/auth');
    const credentialsProvider = authOptions.providers.find(
      (p: any) => p.id === 'credentials'
    ) as any;
    const result = await credentialsProvider.options.authorize(
      { email: 'test@example.com', password: 'correct' },
      {} as any
    );
    expect(result).toEqual({
      id: '1',
      email: 'test@example.com',
      name: 'Test User',
    });
  });
});
```

Run: `npx vitest run src/__tests__/auth/auth.test.ts` — expect all tests to FAIL (module not found).

- [ ] **Step 2: Implement NextAuth config**

Create `src/lib/auth.ts`:

```typescript
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/auth/signin',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};
```

Run: `npx vitest run src/__tests__/auth/auth.test.ts` — expect all 6 tests to PASS.

- [ ] **Step 3: Create NextAuth route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
```

- [ ] **Step 4: Create NextAuth type augmentation**

Create `src/types/next-auth.d.ts`:

```typescript
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
  }
}
```

- [ ] **Step 5: Write middleware tests**

Create `src/__tests__/auth/middleware.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Auth Middleware Config', () => {
  it('should export a config with protected routes', async () => {
    const { config } = await import('@/middleware');
    expect(config.matcher).toContain('/settings/:path*');
  });
});
```

Run: `npx vitest run src/__tests__/auth/middleware.test.ts` — expect FAIL.

- [ ] **Step 6: Implement middleware**

Create `src/middleware.ts`:

```typescript
import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/auth/signin',
  },
});

export const config = {
  matcher: ['/settings/:path*'],
};
```

Run: `npx vitest run src/__tests__/auth/middleware.test.ts` — expect PASS.

- [ ] **Step 7: Build sign-in page**

Create `src/app/auth/signin/page.tsx`:

```tsx
'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid email or password');
    } else if (result?.url) {
      router.push(result.url);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-headline text-3xl font-black tracking-tighter uppercase italic text-primary-container">
            NETPULSE
          </h1>
          <p className="font-body text-on-surface-variant mt-2">
            Sign in to follow teams and set reminders
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/15">
          {error && (
            <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg mb-6 font-label text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-container text-white py-3 rounded-lg font-headline font-bold uppercase tracking-wider hover:bg-primary-container/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-outline-variant" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-surface-container-lowest px-4 font-label text-xs text-on-surface-variant uppercase">
                or
              </span>
            </div>
          </div>

          <button
            onClick={() => signIn('google', { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 bg-surface-container-high text-on-surface py-3 rounded-lg font-label font-bold hover:bg-surface-container-highest transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          <p className="text-center mt-6 font-body text-sm text-on-surface-variant">
            Don&apos;t have an account?{' '}
            <Link
              href="/auth/signup"
              className="text-secondary font-bold hover:underline"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build sign-up page**

Create `src/app/auth/signup/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create account');
        setLoading(false);
        return;
      }

      // Auto sign in after successful registration
      await signIn('credentials', {
        email,
        password,
        callbackUrl: '/',
      });
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-headline text-3xl font-black tracking-tighter uppercase italic text-primary-container">
            NETPULSE
          </h1>
          <p className="font-body text-on-surface-variant mt-2">
            Create an account to personalize your experience
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/15">
          {error && (
            <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg mb-6 font-label text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                required
              />
            </div>

            <div>
              <label className="block font-label text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-outline-variant bg-surface-container-low font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-secondary"
                minLength={8}
                required
              />
              <p className="font-label text-[10px] text-on-surface-variant mt-1">
                Minimum 8 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-container text-white py-3 rounded-lg font-headline font-bold uppercase tracking-wider hover:bg-primary-container/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center mt-6 font-body text-sm text-on-surface-variant">
            Already have an account?{' '}
            <Link
              href="/auth/signin"
              className="text-secondary font-bold hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Create signup API route**

Create `src/app/api/auth/signup/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
      },
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 10: Create AuthButton component**

Create `src/components/auth/AuthButton.tsx`:

```tsx
'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="w-8 h-8 rounded-full bg-surface-container-high animate-pulse" />
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-headline font-bold text-xs">
          {session.user.name?.charAt(0).toUpperCase() || 'U'}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="font-label text-xs text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/auth/signin"
      className="font-label text-xs font-bold uppercase tracking-wider text-secondary hover:text-secondary/80 transition-colors"
    >
      Sign In
    </Link>
  );
}
```

- [ ] **Step 11: Create SessionProvider wrapper**

Create `src/components/providers/Providers.tsx`:

```tsx
'use client'

import { SessionProvider } from 'next-auth/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
```

Then modify `src/app/layout.tsx` to wrap the AppShell with `<Providers>`:

```tsx
// Add this import alongside existing imports:
import { Providers } from '@/components/providers/Providers';

// Update the <body> to wrap AppShell:
<body className="font-body antialiased">
  <Providers>
    <AppShell>{children}</AppShell>
  </Providers>
</body>
```

This ensures `useSession()` works in any client component throughout the app.

- [ ] **Step 12: Install dependencies, verify build**

```bash
npm install next-auth @auth/prisma-adapter bcryptjs
npm install -D @types/bcryptjs
npx vitest run src/__tests__/auth/
```

Expect: all auth tests PASS.

- [ ] **Step 13: Commit**

```bash
git add -A && git commit -m "feat: add NextAuth.js authentication with credentials and Google OAuth"
```

---

### Task 13: Live Game Center Page (`/match/[matchId]/live`)

**Files:**
- Create: `src/hooks/useMatchSocket.ts`
- Create: `src/app/match/[matchId]/live/page.tsx`
- Create: `src/components/match/LiveScoreHero.tsx`
- Create: `src/components/match/LiveLineups.tsx`
- Create: `src/components/match/MatchStatsComparison.tsx`
- Create: `src/components/match/LivePlayByPlay.tsx`
- Test: `src/__tests__/hooks/useMatchSocket.test.ts`
- Test: `src/__tests__/match/live-page.test.tsx`

**Reference:** `stitch-designs/live-game-center/index.html`

**Socket.io events consumed** (from spec):
| Event | Payload |
|-------|---------|
| `score:update` | `{ matchId, homeScore, awayScore, currentQuarter, currentTime }` |
| `stats:update` | `{ matchId, playerStats: PlayerMatchStats[] }` |
| `match:status` | `{ matchId, status: "LIVE" \| "COMPLETED", quarter?, time? }` |
| `scoreflow:add` | `{ matchId, period, scoringTeamId, homeScore, awayScore, periodSeconds }` |
| `match:subscribe` | Client sends `{ matchId }` to join room |
| `match:unsubscribe` | Client sends `{ matchId }` to leave room |

- [ ] **Step 1: Define Socket.io event types**

Create `src/types/socket.ts`:

```typescript
import type { PlayerMatchStats } from '@prisma/client';

export interface ScoreUpdatePayload {
  matchId: string;
  homeScore: number;
  awayScore: number;
  currentQuarter: number;
  currentTime: string;
}

export interface StatsUpdatePayload {
  matchId: string;
  playerStats: PlayerMatchStats[];
}

export interface MatchStatusPayload {
  matchId: string;
  status: 'LIVE' | 'COMPLETED';
  quarter?: number;
  time?: string;
}

export interface ScoreFlowAddPayload {
  matchId: string;
  period: number;
  scoringTeamId: string;
  homeScore: number;
  awayScore: number;
  periodSeconds: number;
}

export interface ServerToClientEvents {
  'score:update': (payload: ScoreUpdatePayload) => void;
  'stats:update': (payload: StatsUpdatePayload) => void;
  'match:status': (payload: MatchStatusPayload) => void;
  'scoreflow:add': (payload: ScoreFlowAddPayload) => void;
}

export interface ClientToServerEvents {
  'match:subscribe': (payload: { matchId: string }) => void;
  'match:unsubscribe': (payload: { matchId: string }) => void;
}
```

- [ ] **Step 2: Write useMatchSocket hook tests**

Create `src/__tests__/hooks/useMatchSocket.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock socket.io-client
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { useMatchSocket } from '@/hooks/useMatchSocket';

describe('useMatchSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should subscribe to match room on mount', () => {
    renderHook(() => useMatchSocket('match-123'));
    expect(mockSocket.emit).toHaveBeenCalledWith('match:subscribe', {
      matchId: 'match-123',
    });
  });

  it('should register all event listeners', () => {
    renderHook(() => useMatchSocket('match-123'));
    const registeredEvents = mockSocket.on.mock.calls.map(
      (call: any) => call[0]
    );
    expect(registeredEvents).toContain('score:update');
    expect(registeredEvents).toContain('stats:update');
    expect(registeredEvents).toContain('match:status');
    expect(registeredEvents).toContain('scoreflow:add');
  });

  it('should unsubscribe and disconnect on unmount', () => {
    const { unmount } = renderHook(() => useMatchSocket('match-123'));
    unmount();
    expect(mockSocket.emit).toHaveBeenCalledWith('match:unsubscribe', {
      matchId: 'match-123',
    });
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('should update score state on score:update event', () => {
    renderHook(() => useMatchSocket('match-123'));

    // Find the score:update handler
    const scoreHandler = mockSocket.on.mock.calls.find(
      (call: any) => call[0] === 'score:update'
    )?.[1];

    expect(scoreHandler).toBeDefined();
  });
});
```

Run: `npx vitest run src/__tests__/hooks/useMatchSocket.test.ts` — expect FAIL.

- [ ] **Step 3: Implement useMatchSocket hook**

Create `src/hooks/useMatchSocket.ts`:

```typescript
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  StatsUpdatePayload,
  MatchStatusPayload,
  ScoreFlowAddPayload,
} from '@/types/socket';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MatchSocketState {
  score: ScoreUpdatePayload | null;
  playerStats: StatsUpdatePayload | null;
  matchStatus: MatchStatusPayload | null;
  scoreFlow: ScoreFlowAddPayload[];
  isConnected: boolean;
}

export function useMatchSocket(matchId: string) {
  const socketRef = useRef<TypedSocket | null>(null);
  const [state, setState] = useState<MatchSocketState>({
    score: null,
    playerStats: null,
    matchStatus: null,
    scoreFlow: [],
    isConnected: false,
  });

  useEffect(() => {
    const socket: TypedSocket = io({
      path: '/api/socketio',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = socket;

    socket.on('connect' as any, () => {
      setState((prev) => ({ ...prev, isConnected: true }));
      socket.emit('match:subscribe', { matchId });
    });

    socket.on('disconnect' as any, () => {
      setState((prev) => ({ ...prev, isConnected: false }));
    });

    socket.on('score:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, score: payload }));
      }
    });

    socket.on('stats:update', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, playerStats: payload }));
      }
    });

    socket.on('match:status', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({ ...prev, matchStatus: payload }));
      }
    });

    socket.on('scoreflow:add', (payload) => {
      if (payload.matchId === matchId) {
        setState((prev) => ({
          ...prev,
          scoreFlow: [...prev.scoreFlow, payload],
        }));
      }
    });

    // Subscribe to match room
    socket.emit('match:subscribe', { matchId });

    return () => {
      socket.emit('match:unsubscribe', { matchId });
      socket.off('score:update');
      socket.off('stats:update');
      socket.off('match:status');
      socket.off('scoreflow:add');
      socket.disconnect();
    };
  }, [matchId]);

  return state;
}
```

Run: `npx vitest run src/__tests__/hooks/useMatchSocket.test.ts` — expect PASS.

- [ ] **Step 4: Build LiveScoreHero component**

Create `src/components/match/LiveScoreHero.tsx`:

```tsx
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { Match, Team } from '@prisma/client';

interface LiveScoreHeroProps {
  match: Match & { homeTeam: Team; awayTeam: Team };
  liveScore?: { homeScore: number; awayScore: number; currentQuarter: number; currentTime: string } | null;
  matchStatus?: { status: 'LIVE' | 'COMPLETED' } | null;
}

export function LiveScoreHero({ match, liveScore, matchStatus }: LiveScoreHeroProps) {
  const homeScore = liveScore?.homeScore ?? match.homeScore;
  const awayScore = liveScore?.awayScore ?? match.awayScore;
  const quarter = liveScore?.currentQuarter ?? match.currentQuarter;
  const time = liveScore?.currentTime ?? match.currentTime;
  const isLive = matchStatus?.status === 'LIVE' || match.status === 'LIVE';

  return (
    <div className="relative overflow-hidden rounded-xl bg-primary-container text-white p-8 md:p-12 shadow-2xl">
      {/* Gradient overlay */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-secondary/20 to-transparent pointer-events-none" />

      <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">
        {/* Home team */}
        <div className="flex flex-col items-center md:items-start text-center md:text-left gap-4">
          <TeamBadge team={match.homeTeam} size="lg" />
          <div>
            <h2 className="font-headline text-3xl font-extrabold tracking-tighter uppercase italic">
              {match.homeTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-xs tracking-widest uppercase">
              Home Team
            </p>
          </div>
        </div>

        {/* Score center */}
        <div className="flex flex-col items-center gap-2">
          {isLive && (
            <div className="bg-secondary px-3 py-1 rounded-full flex items-center gap-2 mb-4">
              <LiveIndicator />
              <span className="font-label text-[10px] font-bold uppercase tracking-tighter text-on-secondary">
                LIVE Q{quarter} {time && `\u2022 ${time}`}
              </span>
            </div>
          )}
          <div className="flex items-center gap-8">
            <span className="font-headline text-7xl md:text-9xl font-black tracking-tighter">
              {homeScore}
            </span>
            <span className="font-headline text-2xl font-light text-on-primary-container">
              &mdash;
            </span>
            <span className="font-headline text-7xl md:text-9xl font-black tracking-tighter">
              {awayScore}
            </span>
          </div>
          <p className="font-label text-xs uppercase tracking-widest text-secondary-fixed font-bold mt-4">
            Round {match.round} &bull; {match.venue}
          </p>
        </div>

        {/* Away team */}
        <div className="flex flex-col items-center md:items-end text-center md:text-right gap-4">
          <TeamBadge team={match.awayTeam} size="lg" />
          <div>
            <h2 className="font-headline text-3xl font-extrabold tracking-tighter uppercase italic">
              {match.awayTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-xs tracking-widest uppercase">
              Away Team
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build LiveLineups component**

Create `src/components/match/LiveLineups.tsx`:

```tsx
import type { Player, PlayerMatchStats, Team } from '@prisma/client';

type PlayerWithStats = Player & { matchStats: PlayerMatchStats[] };

interface LiveLineupsProps {
  homeTeam: Team;
  awayTeam: Team;
  homePlayers: PlayerWithStats[];
  awayPlayers: PlayerWithStats[];
}

function getStatLabel(player: PlayerWithStats): string {
  const stats = player.matchStats[0];
  if (!stats) return '';
  if (player.position === 'GS' || player.position === 'GA') {
    return `${stats.goals}/${stats.attempts}`;
  }
  if (player.position === 'WA') return `${stats.goalAssists} AST`;
  if (player.position === 'C') return `${stats.feeds} FEED`;
  if (player.position === 'WD') return `${stats.deflections} DEF`;
  if (player.position === 'GD') return `${stats.intercepts} INT`;
  if (player.position === 'GK') return `${stats.intercepts} INT`;
  return '';
}

export function LiveLineups({
  homeTeam,
  awayTeam,
  homePlayers,
  awayPlayers,
}: LiveLineupsProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
      <h3 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
        <span className="material-symbols-outlined text-secondary">groups</span>
        Live Lineups
      </h3>
      <div className="grid grid-cols-2 gap-12">
        {/* Home team */}
        <div className="space-y-4">
          <p className="font-label text-[10px] font-black uppercase text-secondary border-b border-outline-variant pb-2">
            {homeTeam.name}
          </p>
          <div className="space-y-3">
            {homePlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between group cursor-pointer p-2 rounded hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-primary-container text-white flex items-center justify-center text-[10px] font-bold">
                    {player.position}
                  </span>
                  <span className="font-body font-semibold">{player.name}</span>
                </div>
                <span className="font-label text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
                  {getStatLabel(player)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Away team */}
        <div className="space-y-4">
          <p className="font-label text-[10px] font-black uppercase text-secondary border-b border-outline-variant pb-2 text-right">
            {awayTeam.name}
          </p>
          <div className="space-y-3">
            {awayPlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between flex-row-reverse group cursor-pointer p-2 rounded hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-3 flex-row-reverse">
                  <span className="w-8 h-8 rounded-full bg-secondary text-white flex items-center justify-center text-[10px] font-bold">
                    {player.position}
                  </span>
                  <span className="font-body font-semibold">{player.name}</span>
                </div>
                <span className="font-label text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
                  {getStatLabel(player)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Build MatchStatsComparison component**

Create `src/components/match/MatchStatsComparison.tsx`:

```tsx
interface StatBar {
  label: string;
  homeValue: number;
  awayValue: number;
  format?: 'number' | 'percentage';
}

interface MatchStatsComparisonProps {
  stats: StatBar[];
}

export function MatchStatsComparison({ stats }: MatchStatsComparisonProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
      <div className="flex justify-between items-center mb-8">
        <h3 className="font-headline text-xl font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            analytics
          </span>
          Key Match Stats
        </h3>
      </div>
      <div className="space-y-6">
        {stats.map((stat) => {
          const total = stat.homeValue + stat.awayValue;
          const homePct = total > 0 ? (stat.homeValue / total) * 100 : 50;
          const awayPct = 100 - homePct;
          const suffix = stat.format === 'percentage' ? '%' : '';

          return (
            <div key={stat.label} className="space-y-2">
              <div className="flex justify-between text-xs font-bold font-label uppercase">
                <span>
                  {stat.homeValue}
                  {suffix}
                </span>
                <span>{stat.label}</span>
                <span>
                  {stat.awayValue}
                  {suffix}
                </span>
              </div>
              <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-primary-container"
                  style={{ width: `${homePct}%` }}
                />
                <div
                  className="h-full bg-secondary"
                  style={{ width: `${awayPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build LivePlayByPlay component**

Create `src/components/match/LivePlayByPlay.tsx`:

```tsx
import type { ScoreFlowAddPayload } from '@/types/socket';

interface PlayByPlayEntry {
  time: string;
  quarter: number;
  description: string;
  isScoring: boolean;
  score?: string;
}

interface LivePlayByPlayProps {
  entries: PlayByPlayEntry[];
}

export function LivePlayByPlay({ entries }: LivePlayByPlayProps) {
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden shadow-2xl sticky top-24">
      <div className="bg-slate-900 p-4 border-b border-slate-800 flex items-center justify-between">
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
      <div className="h-[600px] overflow-y-auto p-4 space-y-6">
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-4 relative">
            <div className="flex-none flex flex-col items-center">
              <div
                className={`w-1.5 h-1.5 rounded-full mt-2 ${
                  entry.isScoring ? 'bg-lime-400' : 'bg-slate-600'
                }`}
              />
              {i < entries.length - 1 && (
                <div className="w-px h-full bg-slate-800 mt-2" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-500 font-headline uppercase">
                {entry.time} - Q{entry.quarter}
              </p>
              <p
                className={`text-sm ${
                  entry.isScoring
                    ? 'text-white font-medium'
                    : 'text-slate-300'
                }`}
              >
                {entry.description}
              </p>
              {entry.score && (
                <p className="text-lime-400 text-[10px] font-bold uppercase">
                  Score: {entry.score}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Build the Live Game Center page**

Create `src/app/match/[matchId]/live/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { LiveGameClient } from './LiveGameClient';

interface Props {
  params: Promise<{ matchId: string }>;
}

export default async function LiveGamePage({ params }: Props) {
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: {
        include: {
          players: {
            include: {
              matchStats: {
                where: { matchId },
              },
            },
          },
        },
      },
      awayTeam: {
        include: {
          players: {
            include: {
              matchStats: {
                where: { matchId },
              },
            },
          },
        },
      },
      quarters: { orderBy: { quarter: 'asc' } },
    },
  });

  if (!match) return notFound();

  return <LiveGameClient match={match} />;
}
```

Create `src/app/match/[matchId]/live/LiveGameClient.tsx`:

```tsx
'use client';

import { useMatchSocket } from '@/hooks/useMatchSocket';
import { LiveScoreHero } from '@/components/match/LiveScoreHero';
import { LiveLineups } from '@/components/match/LiveLineups';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import { LivePlayByPlay } from '@/components/match/LivePlayByPlay';
import type { Match, Team, Player, PlayerMatchStats, MatchQuarter } from '@prisma/client';

type FullMatch = Match & {
  homeTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
  awayTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
  quarters: MatchQuarter[];
};

interface LiveGameClientProps {
  match: FullMatch;
}

export function LiveGameClient({ match }: LiveGameClientProps) {
  const { score, playerStats, matchStatus, scoreFlow } = useMatchSocket(match.id);

  // Compute comparison stats from current data
  const homeStats = match.homeTeam.players.flatMap((p) => p.matchStats);
  const awayStats = match.awayTeam.players.flatMap((p) => p.matchStats);

  const sumStat = (stats: PlayerMatchStats[], key: keyof PlayerMatchStats) =>
    stats.reduce((sum, s) => sum + (Number(s[key]) || 0), 0);

  const comparisonStats = [
    {
      label: 'Goals',
      homeValue: sumStat(homeStats, 'goals'),
      awayValue: sumStat(awayStats, 'goals'),
    },
    {
      label: 'Intercepts',
      homeValue: sumStat(homeStats, 'intercepts'),
      awayValue: sumStat(awayStats, 'intercepts'),
    },
    {
      label: 'Deflections',
      homeValue: sumStat(homeStats, 'deflections'),
      awayValue: sumStat(awayStats, 'deflections'),
    },
    {
      label: 'Turnovers',
      homeValue: sumStat(homeStats, 'turnovers'),
      awayValue: sumStat(awayStats, 'turnovers'),
    },
  ];

  // Build play-by-play entries from score flow
  const playByPlayEntries = scoreFlow.map((flow) => ({
    time: `${Math.floor(flow.periodSeconds / 60)}:${String(flow.periodSeconds % 60).padStart(2, '0')}`,
    quarter: flow.period,
    description: `Goal scored. ${flow.homeScore} - ${flow.awayScore}`,
    isScoring: true,
    score: `${flow.homeScore} - ${flow.awayScore}`,
  }));

  return (
    <section className="p-4 md:p-8 space-y-8 max-w-7xl mx-auto">
      <LiveScoreHero match={match} liveScore={score} matchStatus={matchStatus} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <LiveLineups
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            homePlayers={match.homeTeam.players}
            awayPlayers={match.awayTeam.players}
          />
          <MatchStatsComparison stats={comparisonStats} />
        </div>

        <div className="lg:col-span-1">
          <LivePlayByPlay entries={playByPlayEntries} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 9: Install socket.io-client, run tests, verify build**

```bash
npm install socket.io-client
npx vitest run src/__tests__/hooks/useMatchSocket.test.ts
```

Expect: all hook tests PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: add live game center page with Socket.io real-time updates"
```

---

### Task 14: On-Court Visualizer (`/match/[matchId]/court`)

**Files:**
- Create: `src/components/match/NetballCourt.tsx`
- Create: `src/app/match/[matchId]/court/page.tsx`
- Create: `src/app/match/[matchId]/court/CourtClient.tsx`
- Test: `src/__tests__/components/NetballCourt.test.tsx`

**Reference:** `stitch-designs/on-court-visualizer/index.html`

**Note:** Positions are static (designated GS, GA, WA, C, WD, GD, GK placements), not live tracking. Player stat overlays update via WebSocket.

- [ ] **Step 1: Write NetballCourt tests**

Create `src/__tests__/components/NetballCourt.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetballCourt } from '@/components/match/NetballCourt';

const mockHomePlayers = [
  { id: '1', name: 'Player A', position: 'GS' as const, teamId: 'home' },
  { id: '2', name: 'Player B', position: 'GA' as const, teamId: 'home' },
  { id: '3', name: 'Player C', position: 'WA' as const, teamId: 'home' },
  { id: '4', name: 'Player D', position: 'C' as const, teamId: 'home' },
  { id: '5', name: 'Player E', position: 'WD' as const, teamId: 'home' },
  { id: '6', name: 'Player F', position: 'GD' as const, teamId: 'home' },
  { id: '7', name: 'Player G', position: 'GK' as const, teamId: 'home' },
];

const mockAwayPlayers = [
  { id: '8', name: 'Player H', position: 'GS' as const, teamId: 'away' },
  { id: '9', name: 'Player I', position: 'GA' as const, teamId: 'away' },
  { id: '10', name: 'Player J', position: 'WA' as const, teamId: 'away' },
  { id: '11', name: 'Player K', position: 'C' as const, teamId: 'away' },
  { id: '12', name: 'Player L', position: 'WD' as const, teamId: 'away' },
  { id: '13', name: 'Player M', position: 'GD' as const, teamId: 'away' },
  { id: '14', name: 'Player N', position: 'GK' as const, teamId: 'away' },
];

describe('NetballCourt', () => {
  it('should render 14 player nodes (7 per team)', () => {
    const { container } = render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    const playerNodes = container.querySelectorAll('[data-testid^="player-node"]');
    expect(playerNodes).toHaveLength(14);
  });

  it('should render court lines (thirds, centre circle, shooting circles)', () => {
    const { container } = render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    expect(container.querySelector('[data-testid="thirds-line-1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="thirds-line-2"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="centre-circle"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="shooting-circle-top"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="shooting-circle-bottom"]')).toBeTruthy();
  });

  it('should display position abbreviations in nodes', () => {
    render(
      <NetballCourt homePlayers={mockHomePlayers} awayPlayers={mockAwayPlayers} />
    );
    expect(screen.getByText('GS')).toBeTruthy();
    expect(screen.getByText('GK')).toBeTruthy();
  });
});
```

Run: `npx vitest run src/__tests__/components/NetballCourt.test.tsx` — expect FAIL.

- [ ] **Step 2: Implement NetballCourt component**

Create `src/components/match/NetballCourt.tsx`:

```tsx
import type { Position } from '@prisma/client';

interface CourtPlayer {
  id: string;
  name: string;
  position: Position;
  teamId: string;
}

interface NetballCourtProps {
  homePlayers: CourtPlayer[];
  awayPlayers: CourtPlayer[];
}

// Static positions on court (percentage-based x,y).
// Court is vertical: home attacks top, away attacks bottom.
const POSITION_COORDS: Record<Position, { x: number; y: number }> = {
  GS: { x: 42, y: 8 },
  GA: { x: 30, y: 20 },
  WA: { x: 25, y: 40 },
  C: { x: 55, y: 50 },
  WD: { x: 75, y: 60 },
  GD: { x: 60, y: 78 },
  GK: { x: 55, y: 92 },
};

// Away team mirrors: flip y axis
const AWAY_POSITION_COORDS: Record<Position, { x: number; y: number }> = {
  GS: { x: 58, y: 92 },
  GA: { x: 70, y: 80 },
  WA: { x: 75, y: 60 },
  C: { x: 45, y: 50 },
  WD: { x: 25, y: 40 },
  GD: { x: 40, y: 22 },
  GK: { x: 45, y: 8 },
};

export function NetballCourt({ homePlayers, awayPlayers }: NetballCourtProps) {
  return (
    <div className="bg-slate-950 rounded-3xl overflow-hidden shadow-2xl relative aspect-[3/4] md:aspect-[16/10] border-4 border-slate-900">
      <div className="absolute inset-0 flex flex-col p-8 md:p-12 overflow-hidden">
        <div className="w-full h-full border-2 border-slate-700/50 rounded-xl relative flex flex-col">
          {/* Thirds lines */}
          <div
            data-testid="thirds-line-1"
            className="absolute top-1/3 left-0 w-full h-0 border-t border-slate-700/50"
          />
          <div
            data-testid="thirds-line-2"
            className="absolute top-2/3 left-0 w-full h-0 border-t border-slate-700/50"
          />

          {/* Centre circle */}
          <div
            data-testid="centre-circle"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 border border-slate-700/50 rounded-full flex items-center justify-center"
          >
            <div className="w-2 h-2 bg-lime-400 rounded-full blur-[1px]" />
          </div>

          {/* Shooting circles */}
          <div
            data-testid="shooting-circle-top"
            className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 border-b border-x border-slate-700/50 rounded-b-full"
          />
          <div
            data-testid="shooting-circle-bottom"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-48 h-24 border-t border-x border-slate-700/50 rounded-t-full"
          />

          {/* Goal rings */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-3 h-3 bg-secondary rounded-full" />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-3 h-3 bg-secondary rounded-full" />

          {/* Home team players (primary-container blue) */}
          {homePlayers.map((player) => {
            const coords = POSITION_COORDS[player.position];
            return (
              <div
                key={player.id}
                data-testid={`player-node-${player.id}`}
                className="absolute flex flex-col items-center"
                style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
              >
                <div className="w-8 h-8 md:w-10 md:h-10 bg-primary-container text-white border-2 border-on-primary-container rounded-full flex items-center justify-center font-black font-headline text-xs shadow-lg shadow-primary-container/40">
                  {player.position}
                </div>
              </div>
            );
          })}

          {/* Away team players (lime green) */}
          {awayPlayers.map((player) => {
            const coords = AWAY_POSITION_COORDS[player.position];
            return (
              <div
                key={player.id}
                data-testid={`player-node-${player.id}`}
                className="absolute flex flex-col items-center"
                style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
              >
                <div className="w-8 h-8 md:w-10 md:h-10 bg-lime-500 text-slate-950 border-2 border-lime-300 rounded-full flex items-center justify-center font-black font-headline text-xs shadow-lg shadow-lime-500/40">
                  {player.position}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

Run: `npx vitest run src/__tests__/components/NetballCourt.test.tsx` — expect PASS.

- [ ] **Step 3: Build the Court page (server + client)**

Create `src/app/match/[matchId]/court/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { CourtClient } from './CourtClient';

interface Props {
  params: Promise<{ matchId: string }>;
}

export default async function CourtPage({ params }: Props) {
  const { matchId } = await params;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      homeTeam: {
        include: {
          players: {
            include: {
              matchStats: { where: { matchId } },
            },
          },
        },
      },
      awayTeam: {
        include: {
          players: {
            include: {
              matchStats: { where: { matchId } },
            },
          },
        },
      },
    },
  });

  if (!match) return notFound();

  return <CourtClient match={match} />;
}
```

Create `src/app/match/[matchId]/court/CourtClient.tsx`:

```tsx
'use client';

import { useMatchSocket } from '@/hooks/useMatchSocket';
import { NetballCourt } from '@/components/match/NetballCourt';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import type { Match, Team, Player, PlayerMatchStats } from '@prisma/client';

type FullMatch = Match & {
  homeTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
  awayTeam: Team & { players: (Player & { matchStats: PlayerMatchStats[] })[] };
};

interface CourtClientProps {
  match: FullMatch;
}

export function CourtClient({ match }: CourtClientProps) {
  const { score, matchStatus } = useMatchSocket(match.id);

  const homeScore = score?.homeScore ?? match.homeScore;
  const awayScore = score?.awayScore ?? match.awayScore;
  const isLive = matchStatus?.status === 'LIVE' || match.status === 'LIVE';
  const quarter = score?.currentQuarter ?? match.currentQuarter;
  const time = score?.currentTime ?? match.currentTime;

  return (
    <section className="pt-24 px-4 md:px-8 max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8 mb-12">
      {/* Header */}
      <div className="xl:col-span-12 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          {isLive && (
            <div className="inline-flex items-center gap-2 bg-secondary/20 text-secondary px-3 py-1 rounded-full mb-4">
              <LiveIndicator />
              <span className="text-xs font-bold uppercase tracking-widest font-headline">
                Live Tracking
              </span>
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-black font-headline tracking-tighter uppercase text-primary-container">
            Court Visualizer
          </h1>
        </div>
      </div>

      {/* Court */}
      <div className="xl:col-span-8">
        <NetballCourt
          homePlayers={match.homeTeam.players}
          awayPlayers={match.awayTeam.players}
        />
      </div>

      {/* Sidebar widgets */}
      <aside className="xl:col-span-4 flex flex-col gap-6">
        {/* Scoreboard widget */}
        <div className="bg-primary-container rounded-3xl p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/10 rounded-full -translate-y-12 translate-x-12 blur-3xl" />
          <div className="flex justify-between items-center mb-8 relative">
            <span className="text-xs font-black tracking-widest text-lime-400 uppercase font-headline">
              {quarter ? `Quarter ${quarter}` : ''} {time ? `- ${time}` : ''}
            </span>
            {isLive && (
              <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded font-bold font-headline animate-pulse">
                LIVE
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6 relative">
            <div className="flex flex-col items-center text-center">
              <p className="text-on-primary-container text-xs font-bold uppercase font-headline tracking-tight">
                {match.homeTeam.name}
              </p>
              <p className="text-5xl font-black text-white font-headline mt-1">
                {homeScore}
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <p className="text-on-primary-container text-xs font-bold uppercase font-headline tracking-tight">
                {match.awayTeam.name}
              </p>
              <p className="text-5xl font-black text-white font-headline mt-1">
                {awayScore}
              </p>
            </div>
          </div>
        </div>

        {/* Key stats bento */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Goals', home: match.homeScore, away: match.awayScore },
            {
              label: 'Turnovers',
              home: match.homeTeam.players.reduce(
                (sum, p) => sum + (p.matchStats[0]?.turnovers ?? 0),
                0
              ),
              away: match.awayTeam.players.reduce(
                (sum, p) => sum + (p.matchStats[0]?.turnovers ?? 0),
                0
              ),
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-surface-container-lowest rounded-3xl p-5 shadow-sm"
            >
              <p className="text-[10px] font-bold text-on-surface-variant uppercase font-headline tracking-widest mb-1">
                {stat.label}
              </p>
              <p className="text-2xl font-black text-primary font-headline">
                {stat.home} - {stat.away}
              </p>
            </div>
          ))}
        </div>
      </aside>
    </section>
  );
}
```

- [ ] **Step 4: Run tests, verify build**

```bash
npx vitest run src/__tests__/components/NetballCourt.test.tsx
```

Expect: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add on-court visualizer with SVG court and player position nodes"
```

---

### Task 15: Real-Time Infrastructure

**Files:**
- Create: `src/lib/socket-server.ts`
- Create: `src/lib/worker.ts`
- Create: `src/lib/match-sync.ts`
- Modify: `server.ts` (integrate Socket.io server and worker)
- Test: `src/__tests__/lib/match-sync.test.ts`
- Test: `src/__tests__/lib/worker.test.ts`

- [ ] **Step 1: Write match-sync tests**

Create `src/__tests__/lib/match-sync.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    playerMatchStats: {
      upsert: vi.fn(),
    },
    matchQuarter: {
      upsert: vi.fn(),
    },
    scoreFlow: {
      create: vi.fn(),
    },
  },
}));

describe('match-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect score changes and return changed matches', async () => {
    const { prisma } = await import('@/lib/db');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findMany as any).mockResolvedValue([
      {
        id: 'match-1',
        championDataMatchId: 100,
        homeScore: 30,
        awayScore: 28,
        status: 'LIVE',
      },
    ]);

    const changes = await detectChanges({
      matchId: 100,
      homeScore: 32,
      awayScore: 28,
      status: 'LIVE',
      currentQuarter: 3,
      currentTime: '10:00',
    });

    expect(changes).toEqual(
      expect.objectContaining({
        matchId: 'match-1',
        scoreChanged: true,
      })
    );
  });

  it('should return no changes when scores are the same', async () => {
    const { prisma } = await import('@/lib/db');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findMany as any).mockResolvedValue([
      {
        id: 'match-1',
        championDataMatchId: 100,
        homeScore: 30,
        awayScore: 28,
        status: 'LIVE',
      },
    ]);

    const changes = await detectChanges({
      matchId: 100,
      homeScore: 30,
      awayScore: 28,
      status: 'LIVE',
      currentQuarter: 3,
      currentTime: '10:00',
    });

    expect(changes).toEqual(
      expect.objectContaining({
        scoreChanged: false,
      })
    );
  });

  it('should detect status change from LIVE to COMPLETED', async () => {
    const { prisma } = await import('@/lib/db');
    const { detectChanges } = await import('@/lib/match-sync');

    (prisma.match.findMany as any).mockResolvedValue([
      {
        id: 'match-1',
        championDataMatchId: 100,
        homeScore: 55,
        awayScore: 50,
        status: 'LIVE',
      },
    ]);

    const changes = await detectChanges({
      matchId: 100,
      homeScore: 55,
      awayScore: 50,
      status: 'COMPLETED',
      currentQuarter: 4,
      currentTime: '00:00',
    });

    expect(changes).toEqual(
      expect.objectContaining({
        statusChanged: true,
      })
    );
  });
});
```

Run: `npx vitest run src/__tests__/lib/match-sync.test.ts` — expect FAIL.

- [ ] **Step 2: Implement match-sync**

Create `src/lib/match-sync.ts`:

```typescript
import { prisma } from '@/lib/db';
import type { MatchStatus } from '@prisma/client';

interface ChampionDataMatchState {
  matchId: number; // championDataMatchId
  homeScore: number;
  awayScore: number;
  status: string;
  currentQuarter: number;
  currentTime: string;
  playerStats?: Array<{
    championDataPlayerId: number;
    goals: number;
    attempts: number;
    goalAssists: number;
    intercepts: number;
    deflections: number;
    rebounds: number;
    penalties: number;
    feeds: number;
    centrePassReceives: number;
    turnovers: number;
    minutesPlayed: number;
  }>;
  quarterScores?: Array<{
    quarter: number;
    homeScore: number;
    awayScore: number;
  }>;
}

interface ChangeResult {
  matchId: string;
  scoreChanged: boolean;
  statusChanged: boolean;
  newHomeScore: number;
  newAwayScore: number;
  newStatus: MatchStatus;
  currentQuarter: number;
  currentTime: string;
}

export async function detectChanges(
  incoming: ChampionDataMatchState
): Promise<ChangeResult> {
  const matches = await prisma.match.findMany({
    where: { championDataMatchId: incoming.matchId },
  });

  const match = matches[0];
  if (!match) {
    return {
      matchId: '',
      scoreChanged: false,
      statusChanged: false,
      newHomeScore: incoming.homeScore,
      newAwayScore: incoming.awayScore,
      newStatus: incoming.status as MatchStatus,
      currentQuarter: incoming.currentQuarter,
      currentTime: incoming.currentTime,
    };
  }

  const scoreChanged =
    match.homeScore !== incoming.homeScore ||
    match.awayScore !== incoming.awayScore;

  const statusChanged = match.status !== incoming.status;

  return {
    matchId: match.id,
    scoreChanged,
    statusChanged,
    newHomeScore: incoming.homeScore,
    newAwayScore: incoming.awayScore,
    newStatus: incoming.status as MatchStatus,
    currentQuarter: incoming.currentQuarter,
    currentTime: incoming.currentTime,
  };
}

export async function applyChanges(
  changes: ChangeResult,
  incoming: ChampionDataMatchState
): Promise<void> {
  if (!changes.matchId) return;

  // Update match record
  if (changes.scoreChanged || changes.statusChanged) {
    await prisma.match.update({
      where: { id: changes.matchId },
      data: {
        homeScore: changes.newHomeScore,
        awayScore: changes.newAwayScore,
        status: changes.newStatus,
        currentQuarter: changes.currentQuarter,
        currentTime: changes.currentTime,
      },
    });
  }

  // Upsert quarter scores
  if (incoming.quarterScores) {
    for (const qs of incoming.quarterScores) {
      await prisma.matchQuarter.upsert({
        where: {
          matchId_quarter: {
            matchId: changes.matchId,
            quarter: qs.quarter,
          },
        },
        update: {
          homeScore: qs.homeScore,
          awayScore: qs.awayScore,
        },
        create: {
          matchId: changes.matchId,
          quarter: qs.quarter,
          homeScore: qs.homeScore,
          awayScore: qs.awayScore,
        },
      });
    }
  }

  // Upsert player stats
  if (incoming.playerStats) {
    for (const ps of incoming.playerStats) {
      const player = await prisma.player.findUnique({
        where: { championDataPlayerId: ps.championDataPlayerId },
      });
      if (!player) continue;

      await prisma.playerMatchStats.upsert({
        where: {
          playerId_matchId: {
            playerId: player.id,
            matchId: changes.matchId,
          },
        },
        update: {
          goals: ps.goals,
          attempts: ps.attempts,
          goalAssists: ps.goalAssists,
          intercepts: ps.intercepts,
          deflections: ps.deflections,
          rebounds: ps.rebounds,
          penalties: ps.penalties,
          feeds: ps.feeds,
          centrePassReceives: ps.centrePassReceives,
          turnovers: ps.turnovers,
          minutesPlayed: ps.minutesPlayed,
        },
        create: {
          playerId: player.id,
          matchId: changes.matchId,
          goals: ps.goals,
          attempts: ps.attempts,
          goalAssists: ps.goalAssists,
          intercepts: ps.intercepts,
          deflections: ps.deflections,
          rebounds: ps.rebounds,
          penalties: ps.penalties,
          feeds: ps.feeds,
          centrePassReceives: ps.centrePassReceives,
          turnovers: ps.turnovers,
          minutesPlayed: ps.minutesPlayed,
        },
      });
    }
  }
}
```

Run: `npx vitest run src/__tests__/lib/match-sync.test.ts` — expect PASS.

- [ ] **Step 3: Implement Socket.io server setup**

Create `src/lib/socket-server.ts`:

```typescript
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  StatsUpdatePayload,
  MatchStatusPayload,
  ScoreFlowAddPayload,
} from '@/types/socket';

let io: SocketServer<ClientToServerEvents, ServerToClientEvents> | null = null;

export function initSocketServer(httpServer: HttpServer) {
  io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      path: '/api/socketio',
      cors: {
        origin: process.env.NEXTAUTH_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
      },
    }
  );

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    socket.on('match:subscribe', ({ matchId }) => {
      socket.join(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} joined match:${matchId}`);
    });

    socket.on('match:unsubscribe', ({ matchId }) => {
      socket.leave(`match:${matchId}`);
      console.log(`[Socket.io] ${socket.id} left match:${matchId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initSocketServer first.');
  }
  return io;
}

export function broadcastScoreUpdate(matchId: string, payload: ScoreUpdatePayload) {
  getIO().to(`match:${matchId}`).emit('score:update', payload);
}

export function broadcastStatsUpdate(matchId: string, payload: StatsUpdatePayload) {
  getIO().to(`match:${matchId}`).emit('stats:update', payload);
}

export function broadcastMatchStatus(matchId: string, payload: MatchStatusPayload) {
  getIO().to(`match:${matchId}`).emit('match:status', payload);
}

export function broadcastScoreFlowAdd(matchId: string, payload: ScoreFlowAddPayload) {
  getIO().to(`match:${matchId}`).emit('scoreflow:add', payload);
}
```

- [ ] **Step 4: Write worker tests**

Create `src/__tests__/lib/worker.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/match-sync', () => ({
  detectChanges: vi.fn(),
  applyChanges: vi.fn(),
}));

describe('Worker', () => {
  it('should export getPollingInterval function', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(typeof getPollingInterval).toBe('function');
  });

  it('should return 30s for live matches', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true)).toBe(30_000);
  });

  it('should return 15min for match day with no live match', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, true)).toBe(900_000);
  });

  it('should return 6h for off-season', async () => {
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(false, false)).toBe(21_600_000);
  });
});
```

Run: `npx vitest run src/__tests__/lib/worker.test.ts` — expect FAIL.

- [ ] **Step 5: Implement background worker**

Create `src/lib/worker.ts`:

```typescript
import { prisma } from '@/lib/db';
import { detectChanges, applyChanges } from '@/lib/match-sync';
import {
  broadcastScoreUpdate,
  broadcastStatsUpdate,
  broadcastMatchStatus,
} from '@/lib/socket-server';

const POLL_LIVE = 30_000; // 30 seconds
const POLL_MATCH_DAY = 900_000; // 15 minutes
const POLL_OFF_SEASON = 21_600_000; // 6 hours

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export function getPollingInterval(
  hasLiveMatch: boolean,
  isMatchDay: boolean
): number {
  if (hasLiveMatch) return POLL_LIVE;
  if (isMatchDay) return POLL_MATCH_DAY;
  return POLL_OFF_SEASON;
}

async function checkForLiveMatches(): Promise<boolean> {
  const liveCount = await prisma.match.count({
    where: { status: 'LIVE' },
  });
  return liveCount > 0;
}

async function checkIsMatchDay(): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const matchCount = await prisma.match.count({
    where: {
      scheduledAt: { gte: today, lt: tomorrow },
    },
  });
  return matchCount > 0;
}

async function pollChampionData(): Promise<void> {
  try {
    const COMP_ID = process.env.CHAMPION_DATA_COMP_ID;
    if (!COMP_ID) return;

    // Fetch live matches from Champion Data
    const res = await fetch(
      `https://mc.championdata.com/data/${COMP_ID}/fixture.json`
    );
    if (!res.ok) {
      console.error('[Worker] Champion Data fetch failed:', res.status);
      return;
    }

    const data = await res.json();

    // Process each match in the fixture
    const matches = data?.fixture?.match || [];
    for (const matchData of matches) {
      if (matchData.matchStatus !== 'LIVE') continue;

      // Fetch detailed match data
      const matchRes = await fetch(
        `https://mc.championdata.com/data/${COMP_ID}/${matchData.matchId}.json`
      );
      if (!matchRes.ok) continue;

      const matchDetail = await matchRes.json();

      const incoming = {
        matchId: matchData.matchId,
        homeScore: matchDetail.matchStats?.homeScore ?? 0,
        awayScore: matchDetail.matchStats?.awayScore ?? 0,
        status: matchData.matchStatus === 'Final' ? 'COMPLETED' : matchData.matchStatus,
        currentQuarter: matchDetail.matchStats?.currentPeriod ?? 0,
        currentTime: matchDetail.matchStats?.currentTime ?? '',
      };

      const changes = await detectChanges(incoming);

      if (changes.matchId && (changes.scoreChanged || changes.statusChanged)) {
        await applyChanges(changes, incoming);

        if (changes.scoreChanged) {
          broadcastScoreUpdate(changes.matchId, {
            matchId: changes.matchId,
            homeScore: changes.newHomeScore,
            awayScore: changes.newAwayScore,
            currentQuarter: changes.currentQuarter,
            currentTime: changes.currentTime,
          });
        }

        if (changes.statusChanged) {
          broadcastMatchStatus(changes.matchId, {
            matchId: changes.matchId,
            status: changes.newStatus as 'LIVE' | 'COMPLETED',
            quarter: changes.currentQuarter,
            time: changes.currentTime,
          });
        }
      }
    }
  } catch (error) {
    console.error('[Worker] Poll error:', error);
  }
}

async function scheduleNextPoll(): Promise<void> {
  if (!isRunning) return;

  const hasLive = await checkForLiveMatches();
  const isMatchDay = await checkIsMatchDay();
  const interval = getPollingInterval(hasLive, isMatchDay);

  console.log(
    `[Worker] Next poll in ${interval / 1000}s (live: ${hasLive}, matchDay: ${isMatchDay})`
  );

  pollTimer = setTimeout(async () => {
    await pollChampionData();
    await scheduleNextPoll();
  }, interval);
}

export function startWorker(): void {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Starting background worker');
  scheduleNextPoll();
}

export function stopWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log('[Worker] Stopped');
}
```

Run: `npx vitest run src/__tests__/lib/worker.test.ts` — expect PASS.

- [ ] **Step 6: Integrate Socket.io server and worker into server.ts**

Modify `server.ts` — add to the existing custom Express server:

```typescript
// Add these imports at the top of server.ts
import { initSocketServer } from './src/lib/socket-server';
import { startWorker, stopWorker } from './src/lib/worker';

// After creating the HTTP server (after `const server = http.createServer(app);`):
// Initialize Socket.io
initSocketServer(server);
console.log('[Server] Socket.io initialized');

// Start background worker
startWorker();
console.log('[Server] Background worker started');

// Graceful shutdown (for Render deploys)
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down gracefully');
  stopWorker();
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down');
  stopWorker();
  server.close(() => process.exit(0));
});
```

- [ ] **Step 7: Install socket.io, run all real-time tests**

```bash
npm install socket.io
npx vitest run src/__tests__/lib/match-sync.test.ts src/__tests__/lib/worker.test.ts
```

Expect: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add real-time infrastructure with Socket.io server and background worker"
```

---

### Task 16: User Personalization & Settings

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/api/teams/route.ts`
- Create: `src/app/api/user/teams/route.ts`
- Create: `src/app/api/user/favorites/route.ts`
- Create: `src/app/api/user/reminders/route.ts`
- Test: `src/__tests__/api/user-teams.test.ts`
- Test: `src/__tests__/api/user-favorites.test.ts`
- Test: `src/__tests__/api/user-reminders.test.ts`

- [ ] **Step 1: Write user teams API tests**

Create `src/__tests__/api/user-teams.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    userTeam: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

describe('User Teams API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 if not authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    (getServerSession as any).mockResolvedValue(null);

    const { GET } = await import('@/app/api/user/teams/route');
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('should return user teams when authenticated', async () => {
    const { getServerSession } = await import('next-auth');
    const { prisma } = await import('@/lib/db');

    (getServerSession as any).mockResolvedValue({
      user: { id: 'user-1' },
    });
    (prisma.userTeam.findMany as any).mockResolvedValue([
      { userId: 'user-1', teamId: 'team-1', team: { id: 'team-1', name: 'Vixens' } },
    ]);

    const { GET } = await import('@/app/api/user/teams/route');
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].team.name).toBe('Vixens');
  });
});
```

Run: `npx vitest run src/__tests__/api/user-teams.test.ts` — expect FAIL.

- [ ] **Step 2: Implement user teams API**

Create `src/app/api/user/teams/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const teams = await prisma.userTeam.findMany({
    where: { userId: session.user.id },
    include: { team: true },
  });

  return NextResponse.json(teams);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { teamId } = await request.json();
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  const userTeam = await prisma.userTeam.create({
    data: {
      userId: session.user.id,
      teamId,
    },
  });

  return NextResponse.json(userTeam, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { teamId } = await request.json();
  if (!teamId) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 });
  }

  await prisma.userTeam.delete({
    where: {
      userId_teamId: {
        userId: session.user.id,
        teamId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
```

Run: `npx vitest run src/__tests__/api/user-teams.test.ts` — expect PASS.

- [ ] **Step 3: Implement favorites API**

Create `src/app/api/user/favorites/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const favorites = await prisma.userFavorite.findMany({
    where: { userId: session.user.id },
    include: {
      match: {
        include: { homeTeam: true, awayTeam: true },
      },
    },
  });

  return NextResponse.json(favorites);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matchId } = await request.json();
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
  }

  const favorite = await prisma.userFavorite.create({
    data: {
      userId: session.user.id,
      matchId,
    },
  });

  return NextResponse.json(favorite, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matchId } = await request.json();
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
  }

  await prisma.userFavorite.delete({
    where: {
      userId_matchId: {
        userId: session.user.id,
        matchId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Implement reminders API**

Create `src/app/api/user/reminders/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reminders = await prisma.userReminder.findMany({
    where: { userId: session.user.id },
    include: {
      match: {
        include: { homeTeam: true, awayTeam: true },
      },
    },
  });

  return NextResponse.json(reminders);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matchId } = await request.json();
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
  }

  const reminder = await prisma.userReminder.create({
    data: {
      userId: session.user.id,
      matchId,
    },
  });

  return NextResponse.json(reminder, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matchId } = await request.json();
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
  }

  await prisma.userReminder.delete({
    where: {
      userId_matchId: {
        userId: session.user.id,
        matchId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Create /api/teams route**

Create `src/app/api/teams/route.ts` — returns all teams from the database (used by the settings page to list teams for following):

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        logoUrl: true,
      },
    });
    return NextResponse.json(teams);
  } catch (error) {
    console.error('Failed to fetch teams:', error);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Build settings page**

Create `src/app/settings/page.tsx`:

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TeamFollow {
  teamId: string;
  team: { id: string; name: string; abbreviation: string; logoUrl: string | null };
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [followedTeams, setFollowedTeams] = useState<TeamFollow[]>([]);
  const [allTeams, setAllTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [teamsRes, followsRes] = await Promise.all([
        fetch('/api/teams'),
        fetch('/api/user/teams'),
      ]);
      if (teamsRes.ok) setAllTeams(await teamsRes.json());
      if (followsRes.ok) setFollowedTeams(await followsRes.json());
      setLoading(false);
    }
    load();
  }, []);

  const followedIds = new Set(followedTeams.map((ft) => ft.teamId));

  const toggleTeam = async (teamId: string) => {
    if (followedIds.has(teamId)) {
      await fetch('/api/user/teams', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      setFollowedTeams((prev) => prev.filter((ft) => ft.teamId !== teamId));
    } else {
      const res = await fetch('/api/user/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      if (res.ok) {
        const team = allTeams.find((t) => t.id === teamId);
        setFollowedTeams((prev) => [...prev, { teamId, team }]);
      }
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface-container-high rounded w-1/3" />
          <div className="h-4 bg-surface-container-high rounded w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="font-headline text-3xl font-black tracking-tighter uppercase text-primary-container">
          Settings
        </h1>
        <p className="font-body text-on-surface-variant mt-2">
          Signed in as {session?.user?.email}
        </p>
      </div>

      {/* My Teams */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            favorite
          </span>
          My Teams
        </h2>
        <p className="font-body text-sm text-on-surface-variant mb-6">
          Follow teams to see their fixtures first on the home page.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {allTeams.map((team) => (
            <button
              key={team.id}
              onClick={() => toggleTeam(team.id)}
              className={`p-4 rounded-xl border-2 transition-all text-center ${
                followedIds.has(team.id)
                  ? 'border-secondary bg-secondary/10'
                  : 'border-outline-variant/30 hover:border-outline-variant'
              }`}
            >
              {team.logoUrl && (
                <img
                  src={team.logoUrl}
                  alt={team.name}
                  className="w-12 h-12 mx-auto mb-2 object-contain"
                />
              )}
              <p className="font-headline text-sm font-bold">{team.abbreviation}</p>
              <p className="font-label text-[10px] text-on-surface-variant">
                {team.name}
              </p>
              {followedIds.has(team.id) && (
                <span className="inline-block mt-2 text-secondary text-[10px] font-bold uppercase">
                  Following
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Notification preferences placeholder */}
      <section className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
        <h2 className="font-headline text-xl font-bold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">
            notifications
          </span>
          Notifications
        </h2>
        <p className="font-body text-sm text-on-surface-variant">
          In-app match reminders are enabled for your followed teams. Browser push
          notifications coming in a future update.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Run tests, verify build**

```bash
npx vitest run src/__tests__/api/user-teams.test.ts
```

Expect: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: add user personalization with follow teams, favorites, and reminders"
```

---

### Task 17: Deployment (Render)

**Files:**
- Create: `render.yaml`
- Create: `src/app/api/health/route.ts`
- Modify: `package.json` (verify build/start scripts)
- Test: `src/__tests__/api/health.test.ts`

- [ ] **Step 1: Write health endpoint test**

Create `src/__tests__/api/health.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('Health API', () => {
  it('should export a GET handler', async () => {
    const { GET } = await import('@/app/api/health/route');
    expect(typeof GET).toBe('function');
  });

  it('should return 200 with status ok', async () => {
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });
});
```

Run: `npx vitest run src/__tests__/api/health.test.ts` — expect FAIL.

- [ ] **Step 2: Implement health endpoint**

Create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
}
```

Run: `npx vitest run src/__tests__/api/health.test.ts` — expect PASS.

- [ ] **Step 3: Create Render blueprint**

Create `render.yaml`:

```yaml
services:
  - type: web
    runtime: node
    name: netpulse
    region: sydney
    plan: starter
    buildCommand: npm ci && npx prisma generate && npm run build
    startCommand: npx tsx server.ts
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        sync: false
      - key: NEXTAUTH_SECRET
        generateValue: true
      - key: NEXTAUTH_URL
        sync: false
      - key: GOOGLE_CLIENT_ID
        sync: false
      - key: GOOGLE_CLIENT_SECRET
        sync: false
      - key: CHAMPION_DATA_COMP_ID
        sync: false
```

- [ ] **Step 4: Verify package.json scripts**

Ensure `package.json` contains:

```json
{
  "scripts": {
    "dev": "npx tsx watch server.ts",
    "build": "next build",
    "start": "npx tsx server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Verify build succeeds**

```bash
npm run build
```

Expect: Build completes without errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Render deployment config with health check endpoint"
```

---

## Dependencies

Install all new dependencies in one go at the start:

```bash
npm install next-auth @auth/prisma-adapter bcryptjs socket.io socket.io-client
npm install -D @types/bcryptjs
```

## Test Summary

| Task | Test Files | Test Count |
|------|-----------|------------|
| 12 — Auth | `auth.test.ts`, `middleware.test.ts` | 7 |
| 13 — Live Game | `useMatchSocket.test.ts` | 4 |
| 14 — Court | `NetballCourt.test.tsx` | 3 |
| 15 — Real-Time | `match-sync.test.ts`, `worker.test.ts` | 7 |
| 16 — Personalization | `user-teams.test.ts` | 2 |
| 17 — Deployment | `health.test.ts` | 2 |
| **Total** | **9 files** | **25 tests** |
