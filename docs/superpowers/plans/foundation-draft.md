# Foundation & Data Layer (Tasks 1-4)

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
  variable: "--font-lexend",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
  /* Fonts */
  --font-headline: var(--font-lexend), sans-serif;
  --font-body: var(--font-manrope), sans-serif;
  --font-label: var(--font-inter), sans-serif;

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
    "start": "NODE_ENV=production node server.js",
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

- [ ] **Step 4: Create the seed script**

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
