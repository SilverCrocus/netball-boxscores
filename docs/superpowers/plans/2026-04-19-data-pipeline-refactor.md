# Data Pipeline Refactor Implementation Plan

> **Execution mode:** Team of agents — 3 parallel tracks with a coordinating lead. See **Team Execution Strategy** below.

**Goal:** Restructure the data pipeline into a disciplined ingest → validate → process → broadcast flow with an audit trail, single live detection, server-driven clock, and fixed polling intervals.

**Architecture:** Worker splits into three phases (ingest, process, broadcast) with a new PollLog audit table. A single `getLiveState()` function replaces five scattered live-detection implementations. Client-side clock interpolation is removed — the UI displays exactly what the server provides.

**Tech Stack:** Next.js 15, TypeScript, Prisma 6.x, PostgreSQL, Socket.io, Vitest

**Spec:** `docs/superpowers/specs/2026-04-19-data-pipeline-refactor-design.md`

---

## Team Execution Strategy

### Team Composition

| Agent | Type | Track | Tasks | Files Owned |
|-------|------|-------|-------|-------------|
| **lead** | Coordinator | — | Reviews, assigns, runs Task 13 | — |
| **backend** | code-executor | A: Backend Pipeline | 1, 4, 5, 6, 7, 12 | `src/lib/ingestion.ts`, `src/lib/processing.ts`, `src/lib/broadcasting.ts`, `src/lib/worker.ts`, `prisma/schema.prisma`, `src/lib/match-sync.ts` (delete) |
| **client** | code-executor | B: Client/UI | 8, 9, 10 | `src/hooks/useLocalClock.ts` (delete), `src/hooks/useLiveStatus.ts`, `src/app/live/page.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/BottomNav.tsx`, `src/app/match/[matchId]/live/LiveGameClient.tsx` |
| **infra** | code-executor | C: Infrastructure | 2, 3, 11 | `src/lib/live-state.ts`, `src/lib/worker-health.ts`, `src/app/api/worker-health/route.ts`, `src/app/api/today-matches/route.ts`, `src/app/api/live-status/route.ts` |

### Dependency Graph & Execution Waves

```
Wave 1 (parallel — no dependencies):
  backend: Task 1 (PollLog schema)
  infra:   Task 2 (getLiveState) + Task 3 (worker health)
  client:  Task 8 (delete useLocalClock)

Wave 2 (parallel — wait for Wave 1):
  backend: Task 4 (ingestion) ← needs Task 1
           Task 5 (processing) — no blocker, start immediately
           Task 6 (broadcasting) — no blocker, start immediately
  infra:   Task 11 (today-matches API) — no blocker
  client:  Task 9 (simplify useLiveStatus) ← needs Task 2
           Task 10 (update /live page) ← needs Task 2

Wave 3 (backend only — wait for all Wave 2):
  backend: Task 7 (worker rewrite) ← needs Tasks 2, 3, 4, 5, 6

Wave 4 (backend only — wait for Wave 3):
  backend: Task 12 (delete match-sync.ts, update CLAUDE.md)

Wave 5 (lead — wait for all):
  lead:    Task 13 (full test suite + fix breakage)
```

### Critical Rule

**No agent touches files owned by another agent.** The file ownership table above is the authority. If an agent discovers it needs to modify a file outside its ownership, it reports the issue to the lead who reassigns or handles it.

---

## File Map

**New files:**
- `src/lib/live-state.ts` — single `getLiveState()` function
- `src/lib/ingestion.ts` — Phase 1: fetch CD + store PollLog
- `src/lib/processing.ts` — Phase 2: validate + transform + write live tables (absorbs `match-sync.ts`)
- `src/lib/broadcasting.ts` — Phase 3: socket emission with delta score flow
- `src/lib/worker-health.ts` — module-level health state + exported getter
- `src/app/api/worker-health/route.ts` — health endpoint
- `src/app/api/today-matches/route.ts` — lightweight match data for homepage reactivity
- `src/lib/__tests__/live-state.test.ts`
- `src/lib/__tests__/ingestion.test.ts`
- `src/lib/__tests__/processing.test.ts`
- `src/lib/__tests__/broadcasting.test.ts`

**Modified files:**
- `prisma/schema.prisma` — add PollLog model
- `src/lib/worker.ts` — slim down to orchestrator (~100 lines)
- `src/hooks/useLiveStatus.ts` — remove `nearLive`
- `src/app/api/live-status/route.ts` — use `getLiveState()`, remove `nearLive`
- `src/app/live/page.tsx` — redirect only on actual LIVE, show fallback
- `src/app/match/[matchId]/live/LiveGameClient.tsx` — remove `useLocalClock` usage
- `src/components/layout/Sidebar.tsx` — remove `nearLive` references
- `src/components/layout/BottomNav.tsx` — remove `nearLive` references

**Deleted files:**
- `src/hooks/useLocalClock.ts`
- `src/lib/match-sync.ts` (absorbed into `processing.ts`)

---

### Task 1: Add PollLog Model to Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/__tests__/prisma-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Add `PollLog` to the required models list in the schema test:

```typescript
// In src/lib/__tests__/prisma-schema.test.ts, update the requiredModels array:
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
  "PollLog",
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/prisma-schema.test.ts`
Expected: FAIL — "PollLog" not found in schema

- [ ] **Step 3: Add PollLog model to schema**

Add to `prisma/schema.prisma` after the `ScoreFlow` model (before the Auth section):

```prisma
model PollLog {
  id            String   @id @default(cuid())
  polledAt      DateTime @default(now())
  competitionId Int
  cdMatchId     Int?
  endpoint      String
  rawResponse   Json
  status        String
  errorMessage  String?
  processingMs  Int?

  @@index([polledAt])
  @@index([cdMatchId, polledAt])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/prisma-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Generate Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 6: Push schema to database**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema."

---

### Task 2: Create `getLiveState()` — Single Live Detection

**Files:**
- Create: `src/lib/live-state.ts`
- Create: `src/lib/__tests__/live-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/live-state.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLiveState } from '@/lib/live-state';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
  excludeSimData: {},
}));

import { prisma } from '@/lib/db';

const mockFindMany = vi.mocked(prisma.match.findMany);
const mockFindFirst = vi.mocked(prisma.match.findFirst);
const mockCount = vi.mocked(prisma.match.count);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLiveState', () => {
  it('returns live match IDs when matches have status LIVE', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'match-1' },
      { id: 'match-2' },
    ] as any);
    mockFindMany.mockResolvedValueOnce([]); // imminent
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.liveMatchIds).toEqual(['match-1', 'match-2']);
  });

  it('returns imminent match IDs for SCHEDULED matches within ±60min', async () => {
    mockFindMany.mockResolvedValueOnce([]); // live
    mockFindMany.mockResolvedValueOnce([
      { id: 'match-3' },
    ] as any);
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.imminentMatchIds).toEqual(['match-3']);
  });

  it('returns nextMatchAt for nearest SCHEDULED match within 1 hour', async () => {
    const nextTime = new Date('2026-04-19T12:00:00Z');
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindFirst.mockResolvedValueOnce({ scheduledAt: nextTime } as any);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.nextMatchAt).toEqual(nextTime);
  });

  it('returns isMatchDay true when matches are scheduled today', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(3);

    const state = await getLiveState();

    expect(state.isMatchDay).toBe(true);
  });

  it('returns all-empty state when no matches', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    mockFindMany.mockResolvedValueOnce([]);
    mockFindFirst.mockResolvedValueOnce(null);
    mockCount.mockResolvedValueOnce(0);

    const state = await getLiveState();

    expect(state.liveMatchIds).toEqual([]);
    expect(state.imminentMatchIds).toEqual([]);
    expect(state.nextMatchAt).toBeNull();
    expect(state.isMatchDay).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/live-state.test.ts`
Expected: FAIL — module `@/lib/live-state` not found

- [ ] **Step 3: Implement `getLiveState()`**

Create `src/lib/live-state.ts`:

```typescript
import { prisma, excludeSimData } from '@/lib/db';

export interface LiveState {
  liveMatchIds: string[];
  imminentMatchIds: string[];
  nextMatchAt: Date | null;
  isMatchDay: boolean;
}

export async function getLiveState(): Promise<LiveState> {
  const now = new Date();
  const sixtyMinsAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const sixtyMinsFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  // Pin to AEST for match-day check
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value) - 1;
  const day = Number(parts.find((p) => p.type === 'day')!.value);
  const aestStartOfDay = new Date(Date.UTC(year, month, day) - 11 * 60 * 60 * 1000);
  const aestEndOfDay = new Date(Date.UTC(year, month, day + 1) - 10 * 60 * 60 * 1000);

  const [liveMatches, imminentMatches, nextMatch, matchDayCount] =
    await Promise.all([
      prisma.match.findMany({
        where: { ...excludeSimData, status: 'LIVE' },
        select: { id: true },
      }),
      prisma.match.findMany({
        where: {
          ...excludeSimData,
          status: 'SCHEDULED',
          scheduledAt: { gte: sixtyMinsAgo, lte: sixtyMinsFromNow },
        },
        select: { id: true },
      }),
      prisma.match.findFirst({
        where: {
          ...excludeSimData,
          status: 'SCHEDULED',
          scheduledAt: { gte: now, lte: oneHourFromNow },
        },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      }),
      prisma.match.count({
        where: {
          ...excludeSimData,
          scheduledAt: { gte: aestStartOfDay, lt: aestEndOfDay },
        },
      }),
    ]);

  return {
    liveMatchIds: liveMatches.map((m) => m.id),
    imminentMatchIds: imminentMatches.map((m) => m.id),
    nextMatchAt: nextMatch?.scheduledAt ?? null,
    isMatchDay: matchDayCount > 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/live-state.test.ts`
Expected: PASS

---

### Task 3: Create Worker Health Module

**Files:**
- Create: `src/lib/worker-health.ts`
- Create: `src/app/api/worker-health/route.ts`

- [ ] **Step 1: Create the health state module**

Create `src/lib/worker-health.ts`:

```typescript
const startedAt = Date.now();

let lastPollAt: Date | null = null;
let lastPollStatus: string = 'pending';
let currentIntervalMs: number = 0;
let matchesProcessed: number = 0;
let pollsSinceStartup: number = 0;

export function recordPoll(status: string, matchCount: number): void {
  lastPollAt = new Date();
  lastPollStatus = status;
  matchesProcessed = matchCount;
  pollsSinceStartup++;
}

export function setCurrentInterval(ms: number): void {
  currentIntervalMs = ms;
}

export interface WorkerHealthStatus {
  lastPollAt: string | null;
  lastPollStatus: string;
  currentIntervalMs: number;
  matchesProcessed: number;
  pollsSinceStartup: number;
  uptimeMs: number;
  isHealthy: boolean;
}

export function getWorkerHealth(): WorkerHealthStatus {
  const uptimeMs = Date.now() - startedAt;
  const isHealthy =
    lastPollAt !== null &&
    Date.now() - lastPollAt.getTime() < currentIntervalMs * 2;

  return {
    lastPollAt: lastPollAt?.toISOString() ?? null,
    lastPollStatus,
    currentIntervalMs,
    matchesProcessed,
    pollsSinceStartup,
    uptimeMs,
    isHealthy,
  };
}
```

- [ ] **Step 2: Create the API route**

Create `src/app/api/worker-health/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getWorkerHealth } from '@/lib/worker-health';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getWorkerHealth(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in the new files (there may be pre-existing errors elsewhere)

---

### Task 4: Create Ingestion Module (Phase 1)

**Files:**
- Create: `src/lib/ingestion.ts`
- Create: `src/lib/__tests__/ingestion.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/ingestion.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ingestFromChampionData } from '@/lib/ingestion';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findMany: vi.fn() },
    pollLog: { create: vi.fn(), deleteMany: vi.fn() },
  },
  excludeSimData: {},
}));

vi.mock('@/lib/champion-data', () => ({
  fetchFixture: vi.fn(),
  fetchMatchStats: vi.fn(),
}));

import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats } from '@/lib/champion-data';

const mockFetchFixture = vi.mocked(fetchFixture);
const mockFetchMatchStats = vi.mocked(fetchMatchStats);
const mockPollLogCreate = vi.mocked(prisma.pollLog.create);
const mockPollLogDeleteMany = vi.mocked(prisma.pollLog.deleteMany);
const mockMatchFindMany = vi.mocked(prisma.match.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  mockPollLogDeleteMany.mockResolvedValue({ count: 0 });
});

describe('ingestFromChampionData', () => {
  it('stores fixture response in PollLog', async () => {
    const fixtureMatches = [
      { matchId: 100, matchStatus: 'scheduled' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(mockPollLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          competitionId: 12949,
          endpoint: 'fixture',
          status: 'success',
        }),
      }),
    );
    expect(result.fixture).toEqual(fixtureMatches);
  });

  it('fetches match details for playing matches and stores in PollLog', async () => {
    const fixtureMatches = [
      { matchId: 200, matchStatus: 'playing' },
    ];
    const matchDetail = {
      matchInfo: { matchId: 200, period: 2, periodSeconds: 450 },
    };
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockFetchMatchStats.mockResolvedValue(matchDetail as any);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(mockFetchMatchStats).toHaveBeenCalledWith(12949, 200);
    expect(result.matchDetails.get(200)).toEqual(matchDetail);
  });

  it('logs fetch errors to PollLog without crashing', async () => {
    const fixtureMatches = [
      { matchId: 300, matchStatus: 'playing' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([]);
    mockFetchMatchStats.mockRejectedValue(new Error('Network timeout'));
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(result.matchDetails.size).toBe(0);
    expect(mockPollLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endpoint: 'match-detail',
          status: 'fetch_error',
          errorMessage: 'Network timeout',
        }),
      }),
    );
  });

  it('fetches match details for SCHEDULED matches that CD reports as complete (backfill)', async () => {
    const fixtureMatches = [
      { matchId: 400, matchStatus: 'complete' },
    ];
    mockFetchFixture.mockResolvedValue(fixtureMatches as any);
    mockMatchFindMany.mockResolvedValue([
      { championDataMatchId: 400 },
    ] as any);
    const matchDetail = {
      matchInfo: { matchId: 400, period: 4, periodSeconds: 900 },
    };
    mockFetchMatchStats.mockResolvedValue(matchDetail as any);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    const result = await ingestFromChampionData(12949);

    expect(mockFetchMatchStats).toHaveBeenCalledWith(12949, 400);
    expect(result.matchDetails.get(400)).toEqual(matchDetail);
  });

  it('cleans up PollLog entries older than 7 days', async () => {
    mockFetchFixture.mockResolvedValue([]);
    mockMatchFindMany.mockResolvedValue([]);
    mockPollLogCreate.mockResolvedValue({ id: 'log-1' } as any);

    await ingestFromChampionData(12949);

    expect(mockPollLogDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          polledAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/ingestion.test.ts`
Expected: FAIL — module `@/lib/ingestion` not found

- [ ] **Step 3: Implement the ingestion module**

Create `src/lib/ingestion.ts`:

```typescript
import { prisma } from '@/lib/db';
import { fetchFixture, fetchMatchStats } from '@/lib/champion-data';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

export interface IngestedData {
  fixture: CDFixtureMatch[];
  matchDetails: Map<number, CDMatchStatsResponse>;
  pollLogIds: string[];
}

export async function ingestFromChampionData(
  competitionId: number,
): Promise<IngestedData> {
  const pollLogIds: string[] = [];
  const matchDetails = new Map<number, CDMatchStatsResponse>();

  // Cleanup old PollLog entries (7-day retention)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.pollLog.deleteMany({
    where: { polledAt: { lt: sevenDaysAgo } },
  });

  // Fetch fixture
  let fixture: CDFixtureMatch[];
  try {
    fixture = await fetchFixture(competitionId);
    const log = await prisma.pollLog.create({
      data: {
        competitionId,
        endpoint: 'fixture',
        rawResponse: fixture as any,
        status: 'success',
      },
    });
    pollLogIds.push(log.id);
  } catch (error) {
    await prisma.pollLog.create({
      data: {
        competitionId,
        endpoint: 'fixture',
        rawResponse: {},
        status: 'fetch_error',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    return { fixture: [], matchDetails, pollLogIds };
  }

  // Determine which matches need detail fetching
  const scheduledCDIds = new Set<number>();
  const scheduledDbMatches = await prisma.match.findMany({
    where: { status: 'SCHEDULED', championDataMatchId: { not: null } },
    select: { championDataMatchId: true },
  });
  for (const m of scheduledDbMatches) {
    if (m.championDataMatchId) scheduledCDIds.add(m.championDataMatchId);
  }

  for (const matchData of fixture) {
    const cdStatus = matchData.matchStatus.toLowerCase();
    const isPlaying = cdStatus === 'playing';
    const needsBackfill =
      cdStatus === 'complete' && scheduledCDIds.has(matchData.matchId);
    if (!isPlaying && !needsBackfill) continue;

    try {
      const detail = await fetchMatchStats(competitionId, matchData.matchId);
      matchDetails.set(matchData.matchId, detail);
      const log = await prisma.pollLog.create({
        data: {
          competitionId,
          cdMatchId: matchData.matchId,
          endpoint: 'match-detail',
          rawResponse: detail as any,
          status: 'success',
        },
      });
      pollLogIds.push(log.id);
    } catch (error) {
      await prisma.pollLog.create({
        data: {
          competitionId,
          cdMatchId: matchData.matchId,
          endpoint: 'match-detail',
          rawResponse: {},
          status: 'fetch_error',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return { fixture, matchDetails, pollLogIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/ingestion.test.ts`
Expected: PASS

---

### Task 5: Create Processing Module with Validation (Phase 2)

**Files:**
- Create: `src/lib/processing.ts`
- Create: `src/lib/__tests__/processing.test.ts`

This absorbs the logic from `match-sync.ts` and adds the validation gate.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/processing.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateMatchData, processValidatedMatch } from '@/lib/processing';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

vi.mock('@/lib/db', () => ({
  prisma: {
    match: { findUnique: vi.fn(), update: vi.fn() },
    matchQuarter: { upsert: vi.fn() },
    playerMatchStats: { findMany: vi.fn(), upsert: vi.fn() },
    scoreFlow: { findMany: vi.fn(), upsert: vi.fn() },
    pollLog: { update: vi.fn() },
    $transaction: vi.fn((fns: any[]) => Promise.all(fns)),
  },
  excludeSimData: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateMatchData', () => {
  const baseFixture: CDFixtureMatch = {
    matchId: 100,
    matchNumber: 1,
    matchType: 'Regular',
    roundNumber: 1,
    homeSquadId: 801,
    homeSquadName: 'Vixens',
    homeSquadCode: 'VIX',
    homeSquadShortCode: 'VIX',
    homeSquadNickname: 'Vixens',
    homeSquadScore: 60,
    awaySquadId: 804,
    awaySquadName: 'Fever',
    awaySquadCode: 'FEV',
    awaySquadShortCode: 'FEV',
    awaySquadNickname: 'Fever',
    awaySquadScore: 55,
    venue: 'Arena',
    venueName: 'Arena',
    venueId: 1,
    venueCode: 'ARN',
    localStartTime: '2026-04-19T15:00:00',
    utcStartTime: '2026-04-19T05:00:00Z',
    matchStatus: 'playing',
    period: 2,
    periodSecs: 450,
    periodCompleted: 1,
    isNetball2pt: true,
    finalCode: '',
    finalShortCode: '',
  };

  const baseDetail: CDMatchStatsResponse = {
    matchInfo: {
      matchId: 100,
      round: 1,
      venue: 'Arena',
      homeSquadId: 801,
      homeSquadName: 'Vixens',
      awaySquadId: 804,
      awaySquadName: 'Fever',
      homeScore: 60,
      awayScore: 55,
      matchStatus: 'playing',
      period: 2,
      periodSeconds: 450,
    },
    scoreFlow: [],
    teamStats: {
      home: { squadId: 801, goals: 60, attempts: 70, goalAssists: 20, intercepts: 5, deflections: 3, rebounds: 4, penalties: 2, feeds: 40, centrePassReceives: 15, turnovers: 8 },
      away: { squadId: 804, goals: 55, attempts: 65, goalAssists: 18, intercepts: 4, deflections: 2, rebounds: 3, penalties: 1, feeds: 35, centrePassReceives: 12, turnovers: 10 },
    },
    playerStats: { home: [], away: [] },
    periodScores: [{ period: 1, homeScore: 30, awayScore: 25 }],
  };

  const dbTeams = new Map([
    [801, { id: 'team-1', name: 'Vixens' }],
    [804, { id: 'team-2', name: 'Fever' }],
  ]);

  const dbPlayers = new Map<number, { id: string; name: string; teamId: string }>();

  it('returns valid for well-formed data', () => {
    const result = validateMatchData(baseFixture, baseDetail, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns critical error when home team not found in DB', () => {
    const sparseTeams = new Map([[804, { id: 'team-2', name: 'Fever' }]]);
    const result = validateMatchData(baseFixture, baseDetail, sparseTeams, dbPlayers);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('801'));
  });

  it('returns critical error for invalid quarter (period 0)', () => {
    const badDetail = {
      ...baseDetail,
      matchInfo: { ...baseDetail.matchInfo, period: 0 },
    };
    const result = validateMatchData(baseFixture, badDetail, dbTeams, dbPlayers);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('period'));
  });

  it('returns warning for unknown player IDs', () => {
    const detailWithPlayers = {
      ...baseDetail,
      playerStats: {
        home: [{ playerId: 9999, displayName: 'Unknown', position: 'GS', squadId: 801, goals: 5, attempts: 7, goalAssists: 0, intercepts: 0, deflections: 0, rebounds: 0, penalties: 0, feeds: 0, centrePassReceives: 0, turnovers: 0, minutesPlayed: 30 }],
        away: [],
      },
    };
    const result = validateMatchData(baseFixture, detailWithPlayers, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('9999'));
  });

  it('returns critical error for non-monotonic score flow', () => {
    const badScoreFlow: CDMatchStatsResponse = {
      ...baseDetail,
      scoreFlow: [
        { period: 1, periodSeconds: 100, squadId: 801, scorepoints: 1, homeScore: 1, awayScore: 0 },
        { period: 1, periodSeconds: 200, squadId: 801, scorepoints: 1, homeScore: 0, awayScore: 0 },
      ],
    };
    const result = validateMatchData(baseFixture, badScoreFlow, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.scoreFlowValid).toBe(false);
  });

  it('clamps periodSeconds that exceed quarter length', () => {
    const longTime = {
      ...baseDetail,
      matchInfo: { ...baseDetail.matchInfo, periodSeconds: 1200 },
    };
    const result = validateMatchData(baseFixture, longTime, dbTeams, dbPlayers);
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('clamp'));
    expect(result.validatedData!.currentTime).toBe('960');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/processing.test.ts`
Expected: FAIL — module `@/lib/processing` not found

- [ ] **Step 3: Implement the processing module**

Create `src/lib/processing.ts`. This is the largest new file — it absorbs `match-sync.ts` logic and adds validation:

```typescript
import { prisma } from '@/lib/db';
import { mapMatchStatus } from '@/lib/champion-data';
import { pickStatFields, type StatValues } from '@/lib/stat-utils';
import type { MatchStatus } from '@prisma/client';
import type { CDFixtureMatch, CDMatchStatsResponse } from '@/types/champion-data';

// ── Types ──

interface TeamInfo {
  id: string;
  name: string;
}

interface PlayerInfo {
  id: string;
  name: string;
  teamId: string;
}

export interface ProcessedMatchState {
  cdMatchId: number;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  currentQuarter: number;
  currentTime: string;
  quarterScores?: Array<{ quarter: number; homeScore: number; awayScore: number }>;
  playerStats?: Array<StatValues & { championDataPlayerId: number }>;
  scoreFlow?: Array<{
    period: number;
    periodSeconds: number;
    squadId: number;
    scorepoints: number;
    homeScore: number;
    awayScore: number;
    scoringTeamPrismaId: string;
  }>;
}

export interface ValidationResult {
  valid: boolean;
  scoreFlowValid: boolean;
  warnings: string[];
  errors: string[];
  validatedData: ProcessedMatchState | null;
}

export interface ChangeResult {
  matchId: string;
  scoreChanged: boolean;
  statusChanged: boolean;
  timeChanged: boolean;
  newHomeScore: number;
  newAwayScore: number;
  newStatus: MatchStatus;
  currentQuarter: number;
  currentTime: string;
}

// ── Validation ──

const MAX_QUARTER_SECONDS = 960; // 15min (900s) + 60s buffer
const MAX_ET_SECONDS = 360;      // 5min (300s) + 60s buffer

export function validateMatchData(
  fixture: CDFixtureMatch,
  detail: CDMatchStatsResponse,
  dbTeams: Map<number, TeamInfo>,
  dbPlayers: Map<number, PlayerInfo>,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let valid = true;
  let scoreFlowValid = true;

  // Team validation
  const homeTeam = dbTeams.get(detail.matchInfo.homeSquadId);
  const awayTeam = dbTeams.get(detail.matchInfo.awaySquadId);
  if (!homeTeam) {
    errors.push(`Home team squadId ${detail.matchInfo.homeSquadId} not found in DB`);
    valid = false;
  }
  if (!awayTeam) {
    errors.push(`Away team squadId ${detail.matchInfo.awaySquadId} not found in DB`);
    valid = false;
  }

  // Quarter validation
  const period = detail.matchInfo.period;
  if (period < 1) {
    errors.push(`Invalid period ${period} — must be ≥ 1`);
    valid = false;
  }

  // Time validation (clamp, don't reject)
  let periodSeconds = detail.matchInfo.periodSeconds;
  if (periodSeconds < 0) {
    warnings.push(`Negative periodSeconds ${periodSeconds} — clamp to 0`);
    periodSeconds = 0;
  }
  const maxSecs = period > 4 ? MAX_ET_SECONDS : MAX_QUARTER_SECONDS;
  if (periodSeconds > maxSecs) {
    warnings.push(`periodSeconds ${periodSeconds} exceeds max ${maxSecs} — clamp`);
    periodSeconds = maxSecs;
  }

  // Status validation
  const status = mapMatchStatus(fixture.matchStatus);

  // Player validation (warning only)
  const allPlayers = [
    ...(detail.playerStats?.home ?? []),
    ...(detail.playerStats?.away ?? []),
  ];
  const unknownPlayerIds: number[] = [];
  for (const p of allPlayers) {
    if (!dbPlayers.has(p.playerId)) {
      unknownPlayerIds.push(p.playerId);
    }
  }
  if (unknownPlayerIds.length > 0) {
    warnings.push(`Unknown player IDs: ${unknownPlayerIds.join(', ')}`);
  }

  // Score flow monotonicity check
  if (detail.scoreFlow && detail.scoreFlow.length > 1) {
    let prevTotal = detail.scoreFlow[0].homeScore + detail.scoreFlow[0].awayScore;
    for (let i = 1; i < detail.scoreFlow.length; i++) {
      const total = detail.scoreFlow[i].homeScore + detail.scoreFlow[i].awayScore;
      if (total < prevTotal) {
        scoreFlowValid = false;
        break;
      }
      prevTotal = total;
    }
  }

  if (!valid) {
    return { valid, scoreFlowValid, warnings, errors, validatedData: null };
  }

  // Build validated data
  const validatedData: ProcessedMatchState = {
    cdMatchId: fixture.matchId,
    homeScore: detail.matchInfo.homeScore,
    awayScore: detail.matchInfo.awayScore,
    status,
    currentQuarter: period,
    currentTime: String(periodSeconds),
    quarterScores: detail.periodScores?.map((ps) => ({
      quarter: ps.period,
      homeScore: ps.homeScore,
      awayScore: ps.awayScore,
    })),
    playerStats: allPlayers
      .filter((ps) => dbPlayers.has(ps.playerId))
      .map((ps) => ({
        championDataPlayerId: ps.playerId,
        ...pickStatFields(ps),
      })),
  };

  // Only include score flow if monotonicity passed
  if (scoreFlowValid && detail.scoreFlow && homeTeam && awayTeam) {
    validatedData.scoreFlow = detail.scoreFlow.map((sf) => ({
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      squadId: sf.squadId,
      scorepoints: sf.scorepoints,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scoringTeamPrismaId:
        sf.squadId === detail.matchInfo.homeSquadId
          ? homeTeam.id
          : awayTeam.id,
    }));
  }

  return { valid, scoreFlowValid, warnings, errors, validatedData };
}

// ── Change Detection ──

export async function detectChanges(
  incoming: ProcessedMatchState,
): Promise<ChangeResult> {
  const match = await prisma.match.findUnique({
    where: { championDataMatchId: incoming.cdMatchId },
  });
  if (!match) {
    return {
      matchId: '',
      scoreChanged: false,
      statusChanged: false,
      timeChanged: false,
      newHomeScore: incoming.homeScore,
      newAwayScore: incoming.awayScore,
      newStatus: incoming.status,
      currentQuarter: incoming.currentQuarter,
      currentTime: incoming.currentTime,
    };
  }

  return {
    matchId: match.id,
    scoreChanged:
      match.homeScore !== incoming.homeScore ||
      match.awayScore !== incoming.awayScore,
    statusChanged: match.status !== incoming.status,
    timeChanged:
      match.currentQuarter !== incoming.currentQuarter ||
      match.currentTime !== incoming.currentTime,
    newHomeScore: incoming.homeScore,
    newAwayScore: incoming.awayScore,
    newStatus: incoming.status,
    currentQuarter: incoming.currentQuarter,
    currentTime: incoming.currentTime,
  };
}

// ── Apply Changes (write to live tables) ──

export async function applyChanges(
  changes: ChangeResult,
  incoming: ProcessedMatchState,
): Promise<Map<string, Array<{ playerId: string; name: string }>>> {
  if (!changes.matchId) return new Map();

  if (changes.scoreChanged || changes.statusChanged || changes.timeChanged) {
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

  if (incoming.quarterScores) {
    for (const qs of incoming.quarterScores) {
      await prisma.matchQuarter.upsert({
        where: { matchId_quarter: { matchId: changes.matchId, quarter: qs.quarter } },
        update: { homeScore: qs.homeScore, awayScore: qs.awayScore },
        create: { matchId: changes.matchId, quarter: qs.quarter, homeScore: qs.homeScore, awayScore: qs.awayScore },
      });
    }
  }

  // Scorer attribution
  const scorersByTeam = new Map<string, Array<{ playerId: string; name: string }>>();

  if (incoming.playerStats && incoming.playerStats.length > 0) {
    const players = await prisma.player.findMany({
      where: { championDataPlayerId: { in: incoming.playerStats.map((ps) => ps.championDataPlayerId) } },
      select: { id: true, name: true, championDataPlayerId: true, teamId: true },
    });
    const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

    const oldStats = await prisma.playerMatchStats.findMany({
      where: { matchId: changes.matchId },
      select: { playerId: true, goals: true },
    });
    const oldGoalMap = new Map(oldStats.map((s) => [s.playerId, s.goals]));

    const upserts = incoming.playerStats
      .filter((ps) => playerMap.has(ps.championDataPlayerId))
      .map((ps) => {
        const player = playerMap.get(ps.championDataPlayerId)!;
        const statsData = pickStatFields(ps);
        return prisma.playerMatchStats.upsert({
          where: { playerId_matchId: { playerId: player.id, matchId: changes.matchId } },
          update: statsData,
          create: { playerId: player.id, matchId: changes.matchId, ...statsData },
        });
      });

    await prisma.$transaction(upserts);

    for (const ps of incoming.playerStats) {
      const player = playerMap.get(ps.championDataPlayerId);
      if (!player) continue;
      const oldGoals = oldGoalMap.get(player.id) ?? 0;
      const newGoals = ps.goals - oldGoals;
      if (newGoals > 0) {
        const queue = scorersByTeam.get(player.teamId) ?? [];
        for (let i = 0; i < newGoals; i++) {
          queue.push({ playerId: player.id, name: player.name });
        }
        scorersByTeam.set(player.teamId, queue);
      }
    }
  }

  if (incoming.scoreFlow && incoming.scoreFlow.length > 0) {
    const existing = await prisma.scoreFlow.findMany({
      where: { matchId: changes.matchId },
      select: { period: true, periodSeconds: true },
    });
    const existingKeys = new Set(existing.map((sf) => `${sf.period}-${sf.periodSeconds}`));
    const scorerIdx = new Map<string, number>();

    for (const sf of incoming.scoreFlow) {
      const isNew = !existingKeys.has(`${sf.period}-${sf.periodSeconds}`);
      let scorerPlayerId: string | undefined;
      if (isNew) {
        const queue = scorersByTeam.get(sf.scoringTeamPrismaId);
        if (queue) {
          const idx = scorerIdx.get(sf.scoringTeamPrismaId) ?? 0;
          if (idx < queue.length) {
            scorerPlayerId = queue[idx].playerId;
            scorerIdx.set(sf.scoringTeamPrismaId, idx + 1);
          }
        }
      }

      await prisma.scoreFlow.upsert({
        where: { matchId_period_periodSeconds: { matchId: changes.matchId, period: sf.period, periodSeconds: sf.periodSeconds } },
        update: { homeScore: sf.homeScore, awayScore: sf.awayScore },
        create: {
          matchId: changes.matchId,
          period: sf.period,
          periodSeconds: sf.periodSeconds,
          scoringTeamId: sf.scoringTeamPrismaId,
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
          scorePoints: sf.scorepoints,
          scorerPlayerId: scorerPlayerId ?? null,
        },
      });
    }
  }

  return scorersByTeam;
}

// ── Reconciliation (from match-sync.ts) ──

export async function reconcileCompletedMatches(
  fixtureMatches: CDFixtureMatch[],
): Promise<Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }>> {
  const unresolvedMatches = await prisma.match.findMany({
    where: { status: { in: ['LIVE', 'SCHEDULED'] } },
    select: { id: true, status: true, championDataMatchId: true },
  });
  if (unresolvedMatches.length === 0) return [];

  const fixtureMap = new Map(fixtureMatches.map((fm) => [fm.matchId, fm]));
  const completed: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];

  for (const dbMatch of unresolvedMatches) {
    if (!dbMatch.championDataMatchId) continue;
    const fixture = fixtureMap.get(dbMatch.championDataMatchId);
    if (!fixture || fixture.matchStatus.toLowerCase() !== 'complete') continue;

    await prisma.match.update({
      where: { id: dbMatch.id },
      data: { status: 'COMPLETED', homeScore: fixture.homeSquadScore, awayScore: fixture.awaySquadScore },
    });
    completed.push({
      matchId: dbMatch.id,
      homeScore: fixture.homeSquadScore,
      awayScore: fixture.awaySquadScore,
      finalQuarter: fixture.periodCompleted || fixture.period || 4,
    });
  }

  return completed;
}

// ── Stale match detection (from worker.ts) ──

export async function detectStaleCompletedMatches(): Promise<
  Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }>
> {
  const liveMatches = await prisma.match.findMany({ where: { status: 'LIVE' } });
  const completed: Array<{ matchId: string; homeScore: number; awayScore: number; finalQuarter: number }> = [];
  const now = Date.now();

  for (const match of liveMatches) {
    const quarter = match.currentQuarter ?? 0;
    if (quarter < 4) continue;
    const elapsed = Number(match.currentTime);
    if (isNaN(elapsed)) continue;

    const quarterLength = quarter > 4 ? 300 : 900;
    const remaining = quarterLength - elapsed;
    const sinceUpdate = now - match.updatedAt.getTime();

    if (remaining < 60 && sinceUpdate >= 30_000) {
      console.log(`[Processing] Match ended (fast): ${match.id}`);
      await prisma.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
      completed.push({ matchId: match.id, homeScore: match.homeScore, awayScore: match.awayScore, finalQuarter: quarter });
      continue;
    }

    if (elapsed >= quarterLength) {
      const matchAge = now - match.scheduledAt.getTime();
      if (matchAge >= 90 * 60 * 1000) {
        console.log(`[Processing] Stale LIVE match: ${match.id}`);
        await prisma.match.update({ where: { id: match.id }, data: { status: 'COMPLETED' } });
        completed.push({ matchId: match.id, homeScore: match.homeScore, awayScore: match.awayScore, finalQuarter: quarter });
      }
    }
  }

  return completed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/processing.test.ts`
Expected: PASS

---

### Task 6: Create Broadcasting Module (Phase 3)

**Files:**
- Create: `src/lib/broadcasting.ts`
- Create: `src/lib/__tests__/broadcasting.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/broadcasting.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  broadcastMatchChanges,
  broadcastScoreFlowDelta,
  resetScoreFlowTracking,
} from '@/lib/broadcasting';

vi.mock('@/lib/db', () => ({
  prisma: {
    player: { findMany: vi.fn() },
    scoreFlow: { findMany: vi.fn() },
  },
  excludeSimData: {},
}));

vi.mock('@/lib/socket-server', () => ({
  broadcastScoreUpdate: vi.fn(),
  broadcastMatchStatus: vi.fn(),
  broadcastStatsUpdate: vi.fn(),
  broadcastScoreFlowAdd: vi.fn(),
  broadcastStatEvent: vi.fn(),
}));

import { prisma } from '@/lib/db';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowAdd,
} from '@/lib/socket-server';

const mockPlayerFindMany = vi.mocked(prisma.player.findMany);
const mockScoreFlowFindMany = vi.mocked(prisma.scoreFlow.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  resetScoreFlowTracking();
});

describe('broadcastScoreFlowDelta', () => {
  it('broadcasts all entries on first call (no prior count)', async () => {
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as any);

    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowAdd).toHaveBeenCalledTimes(2);
  });

  it('broadcasts only new entries on subsequent calls', async () => {
    // First call: 2 entries
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
    ] as any);
    await broadcastScoreFlowDelta('match-1');

    vi.mocked(broadcastScoreFlowAdd).mockClear();

    // Second call: 3 entries (1 new)
    mockScoreFlowFindMany.mockResolvedValue([
      { id: '1', period: 1, periodSeconds: 100, scoringTeamId: 't1', homeScore: 1, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '2', period: 1, periodSeconds: 200, scoringTeamId: 't1', homeScore: 2, awayScore: 0, scorePoints: 1, scorerPlayer: null },
      { id: '3', period: 1, periodSeconds: 300, scoringTeamId: 't2', homeScore: 2, awayScore: 1, scorePoints: 1, scorerPlayer: { id: 'p1', name: 'Smith' } },
    ] as any);
    await broadcastScoreFlowDelta('match-1');

    expect(broadcastScoreFlowAdd).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/broadcasting.test.ts`
Expected: FAIL — module `@/lib/broadcasting` not found

- [ ] **Step 3: Implement the broadcasting module**

Create `src/lib/broadcasting.ts`:

```typescript
import { prisma } from '@/lib/db';
import { pickStatFields } from '@/lib/stat-utils';
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowAdd,
  broadcastStatEvent,
} from '@/lib/socket-server';
import type { CDMatchStatsResponse } from '@/types/champion-data';
import type { ChangeResult } from '@/lib/processing';

// ── Score flow delta tracking ──

const matchScoreFlowCounts = new Map<string, number>();

export function resetScoreFlowTracking(): void {
  matchScoreFlowCounts.clear();
}

export async function broadcastScoreFlowDelta(matchId: string): Promise<void> {
  const allEntries = await prisma.scoreFlow.findMany({
    where: { matchId },
    include: { scorerPlayer: { select: { id: true, name: true } } },
    orderBy: [{ period: 'asc' }, { periodSeconds: 'asc' }],
  });

  const lastCount = matchScoreFlowCounts.get(matchId) ?? 0;
  const newEntries = allEntries.slice(lastCount);
  matchScoreFlowCounts.set(matchId, allEntries.length);

  for (const sf of newEntries) {
    broadcastScoreFlowAdd(matchId, {
      matchId,
      period: sf.period,
      periodSeconds: sf.periodSeconds,
      scoringTeamId: sf.scoringTeamId,
      homeScore: sf.homeScore,
      awayScore: sf.awayScore,
      scorePoints: sf.scorePoints,
      scorerPlayerId: sf.scorerPlayer?.id,
      scorerName: sf.scorerPlayer?.name,
    });
  }
}

// ── Match changes broadcast ──

type DbMatchWithTeams = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: { id: string; name: string; abbreviation: string; logoUrl: string | null; championDataTeamId: number | null };
  awayTeam: { id: string; name: string; abbreviation: string; logoUrl: string | null; championDataTeamId: number | null };
};

export async function broadcastMatchChanges(
  changes: ChangeResult,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams | null,
): Promise<void> {
  if (!changes.matchId) return;

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

  if (matchDetail.playerStats) {
    await broadcastPlayerStats(changes.matchId, matchDetail);
  }

  await broadcastScoreFlowDelta(changes.matchId);
}

// ── Player stats broadcast ──

export async function broadcastPlayerStats(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
): Promise<void> {
  if (!matchDetail.playerStats) return;

  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []),
    ...(matchDetail.playerStats.away ?? []),
  ];

  const players = await prisma.player.findMany({
    where: { championDataPlayerId: { in: allPlayerStats.map((ps) => ps.playerId) } },
    select: { id: true, championDataPlayerId: true },
  });
  const playerIdMap = new Map(players.map((p) => [p.championDataPlayerId, p.id]));

  const statsPayload = allPlayerStats
    .filter((ps) => playerIdMap.has(ps.playerId))
    .map((ps) => ({
      playerId: playerIdMap.get(ps.playerId)!,
      currentPosition: ps.position ?? '',
      ...pickStatFields(ps),
    }));

  if (statsPayload.length > 0) {
    broadcastStatsUpdate(matchId, { matchId, playerStats: statsPayload });
  }
}

// ── Intercept events broadcast ──

export async function broadcastInterceptEvents(
  matchId: string,
  matchDetail: CDMatchStatsResponse,
  dbMatch: DbMatchWithTeams,
  oldInterceptMap: Map<string, number>,
  quarter: number,
  time: string,
): Promise<void> {
  const allPlayerStats = [
    ...(matchDetail.playerStats.home ?? []),
    ...(matchDetail.playerStats.away ?? []),
  ];

  const players = await prisma.player.findMany({
    where: { championDataPlayerId: { in: allPlayerStats.map((ps) => ps.playerId) } },
    select: { id: true, name: true, championDataPlayerId: true, teamId: true },
  });
  const playerMap = new Map(players.map((p) => [p.championDataPlayerId, p]));

  for (const ps of allPlayerStats) {
    const player = playerMap.get(ps.playerId);
    if (!player) continue;
    const oldIntercepts = oldInterceptMap.get(player.id) ?? 0;
    const newIntercepts = (ps.intercepts ?? 0) - oldIntercepts;
    if (newIntercepts <= 0) continue;

    const isHome = player.teamId === dbMatch.homeTeamId;
    const team = isHome ? dbMatch.homeTeam : dbMatch.awayTeam;

    for (let i = 0; i < newIntercepts; i++) {
      broadcastStatEvent(matchId, {
        matchId,
        type: 'intercept',
        playerId: player.id,
        playerName: player.name,
        teamId: team.id,
        teamName: team.name,
        teamAbbreviation: team.abbreviation,
        teamLogoUrl: team.logoUrl,
        isHomeTeam: isHome,
        quarter,
        time,
      });
    }
  }
}

// ── Completion broadcast helper ──

export function broadcastCompletion(
  matchId: string,
  homeScore: number,
  awayScore: number,
  finalQuarter: number,
): void {
  broadcastMatchStatus(matchId, {
    matchId,
    status: 'COMPLETED',
    quarter: finalQuarter,
    time: '0',
  });
  broadcastScoreUpdate(matchId, {
    matchId,
    homeScore,
    awayScore,
    currentQuarter: finalQuarter,
    currentTime: '0',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/broadcasting.test.ts`
Expected: PASS

---

### Task 7: Rewrite Worker as Slim Orchestrator

**Files:**
- Modify: `src/lib/worker.ts` (rewrite)

- [ ] **Step 1: Rewrite worker.ts**

Replace the entire contents of `src/lib/worker.ts` with the slim orchestrator that wires together the three phases:

```typescript
import { prisma } from '@/lib/db';
import { getLiveState } from '@/lib/live-state';
import { ingestFromChampionData } from '@/lib/ingestion';
import {
  validateMatchData,
  detectChanges,
  applyChanges,
  reconcileCompletedMatches,
  detectStaleCompletedMatches,
  type ChangeResult,
} from '@/lib/processing';
import {
  broadcastMatchChanges,
  broadcastPlayerStats,
  broadcastInterceptEvents,
  broadcastCompletion,
} from '@/lib/broadcasting';
import { recalculateStandings } from '@/lib/standings';
import { recordPoll, setCurrentInterval } from '@/lib/worker-health';

// ── Polling intervals ──

const POLL_SIM = 2_000;
const POLL_LIVE = 30_000;
const POLL_PRE_MATCH = 60_000;
const POLL_MATCH_DAY = 120_000;
const POLL_OFF_SEASON = 3_600_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

export function getPollingInterval(
  hasLive: boolean,
  isMatchDay: boolean,
  hasPreMatch: boolean,
): number {
  if (process.env.SIMULATION_MODE === 'true') return POLL_SIM;
  if (hasLive) return POLL_LIVE;
  if (hasPreMatch) return POLL_PRE_MATCH;
  if (isMatchDay) return POLL_MATCH_DAY;
  return POLL_OFF_SEASON;
}

// ── Main poll cycle ──

async function pollChampionData(): Promise<void> {
  try {
    const COMP_ID = parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);

    // Phase 1: Ingest
    const ingested = await ingestFromChampionData(COMP_ID);
    if (ingested.fixture.length === 0 && ingested.matchDetails.size === 0) {
      recordPoll('empty', 0);
      return;
    }

    // Load DB lookups for validation
    const dbTeamsRaw = await prisma.team.findMany({
      select: { id: true, name: true, championDataTeamId: true },
    });
    const dbTeams = new Map(
      dbTeamsRaw
        .filter((t) => t.championDataTeamId !== null)
        .map((t) => [t.championDataTeamId!, { id: t.id, name: t.name }]),
    );
    const dbPlayersRaw = await prisma.player.findMany({
      select: { id: true, name: true, championDataPlayerId: true, teamId: true },
    });
    const dbPlayers = new Map(
      dbPlayersRaw
        .filter((p) => p.championDataPlayerId !== null)
        .map((p) => [p.championDataPlayerId!, { id: p.id, name: p.name, teamId: p.teamId }]),
    );

    let matchesProcessed = 0;

    // Phase 2 + 3: Validate, Process, Broadcast per match
    for (const [cdMatchId, matchDetail] of ingested.matchDetails) {
      const fixtureMatch = ingested.fixture.find((f) => f.matchId === cdMatchId);
      if (!fixtureMatch) continue;

      const validation = validateMatchData(fixtureMatch, matchDetail, dbTeams, dbPlayers);

      // Update PollLog status
      const pollLogId = ingested.pollLogIds.find((_, i) => i > 0); // skip fixture log
      if (pollLogId && !validation.valid) {
        await prisma.pollLog.update({
          where: { id: pollLogId },
          data: { status: 'validation_error', errorMessage: validation.errors.join('; ') },
        });
        continue;
      }

      if (!validation.validatedData) continue;

      const startMs = Date.now();
      const changes = await detectChanges(validation.validatedData);
      const hasChanges = changes.scoreChanged || changes.statusChanged || changes.timeChanged;

      // Snapshot intercepts before applying
      let oldInterceptMap: Map<string, number> | undefined;
      if (changes.matchId && matchDetail.playerStats) {
        const oldStats = await prisma.playerMatchStats.findMany({
          where: { matchId: changes.matchId },
          select: { playerId: true, intercepts: true },
        });
        oldInterceptMap = new Map(oldStats.map((s) => [s.playerId, s.intercepts]));
      }

      const dbMatch = changes.matchId
        ? await prisma.match.findUnique({
            where: { id: changes.matchId },
            include: { homeTeam: true, awayTeam: true },
          })
        : null;

      if (changes.matchId && hasChanges) {
        await applyChanges(changes, validation.validatedData);
        await broadcastMatchChanges(changes, matchDetail, dbMatch);
      } else if (changes.matchId && matchDetail.playerStats) {
        await broadcastPlayerStats(changes.matchId, matchDetail);
      }

      if (changes.matchId && oldInterceptMap && matchDetail.playerStats && dbMatch) {
        await broadcastInterceptEvents(
          changes.matchId, matchDetail, dbMatch, oldInterceptMap,
          changes.currentQuarter, changes.currentTime,
        );
      }

      // Update PollLog to processed
      if (pollLogId) {
        await prisma.pollLog.update({
          where: { id: pollLogId },
          data: { status: 'processed', processingMs: Date.now() - startMs },
        });
      }

      matchesProcessed++;
    }

    // Stale match detection
    const staleCompleted = await detectStaleCompletedMatches();
    for (const stale of staleCompleted) {
      broadcastCompletion(stale.matchId, stale.homeScore, stale.awayScore, stale.finalQuarter);
    }

    // Reconcile completed
    const completedMatches = await reconcileCompletedMatches(ingested.fixture);
    for (const completed of completedMatches) {
      broadcastCompletion(completed.matchId, completed.homeScore, completed.awayScore, completed.finalQuarter);
    }

    // Recalculate standings if any matches completed
    if (completedMatches.length > 0 || staleCompleted.length > 0) {
      console.log(`[Worker] ${completedMatches.length + staleCompleted.length} match(es) completed — recalculating standings`);
      try {
        await recalculateStandings();
      } catch (error) {
        console.error('[Worker] Standings recalculation failed:', error);
      }
    }

    recordPoll('success', matchesProcessed);
  } catch (error) {
    console.error('[Worker] Poll error:', error);
    recordPoll('error', 0);
  }
}

// ── Scheduling ──

async function scheduleNextPoll(): Promise<void> {
  if (!isRunning) return;

  const state = await getLiveState();
  const hasLive = state.liveMatchIds.length > 0;
  const hasPreMatch = state.imminentMatchIds.length > 0;
  const interval = getPollingInterval(hasLive, state.isMatchDay, hasPreMatch);
  setCurrentInterval(interval);

  console.log(
    `[Worker] Next poll in ${interval / 1000}s (live: ${hasLive}, preMatch: ${hasPreMatch}, matchDay: ${state.isMatchDay})`,
  );

  pollTimer = setTimeout(async () => {
    await pollChampionData();
    await scheduleNextPoll();
  }, interval);
}

export async function startWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Starting background worker');
  await pollChampionData();
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

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors from worker.ts

---

### Task 8: Delete `useLocalClock` and Update `LiveGameClient`

**Files:**
- Delete: `src/hooks/useLocalClock.ts`
- Modify: `src/app/match/[matchId]/live/LiveGameClient.tsx:20,120`

- [ ] **Step 1: Remove `useLocalClock` import and usage from LiveGameClient**

In `src/app/match/[matchId]/live/LiveGameClient.tsx`:

Remove the import on line 20:
```typescript
// DELETE this line:
import { useLocalClock } from '@/hooks/useLocalClock';
```

Replace line 120:
```typescript
// Before:
const time = useLocalClock(isLive ? serverTime : null) ?? serverTime;

// After:
const time = score?.currentTime ?? match.currentTime;
```

- [ ] **Step 2: Delete the `useLocalClock.ts` file**

Delete `src/hooks/useLocalClock.ts`.

- [ ] **Step 3: Verify build compiles**

Run: `npx vitest run && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors referencing `useLocalClock`

---

### Task 9: Simplify `useLiveStatus` and Remove `nearLive`

**Files:**
- Modify: `src/hooks/useLiveStatus.ts`
- Modify: `src/app/api/live-status/route.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/BottomNav.tsx`

- [ ] **Step 1: Update the API route to use `getLiveState()`**

Replace `src/app/api/live-status/route.ts` contents:

```typescript
import { NextResponse } from 'next/server';
import { getLiveState } from '@/lib/live-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await getLiveState();

  return NextResponse.json(
    {
      hasLive: state.liveMatchIds.length > 0,
      nextMatchAt: state.nextMatchAt,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
```

- [ ] **Step 2: Simplify `useLiveStatus` hook**

Replace `src/hooks/useLiveStatus.ts` contents:

```typescript
'use client';

import { useState, useEffect } from 'react';

interface LiveStatus {
  hasLive: boolean;
  minutesUntilNext: number | null;
}

export function useLiveStatus(): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>({
    hasLive: false,
    minutesUntilNext: null,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/live-status', { cache: 'no-store' });
        const data = await res.json();

        const minutesUntilNext = data.nextMatchAt
          ? Math.max(0, Math.ceil((new Date(data.nextMatchAt).getTime() - Date.now()) / 60000))
          : null;

        setStatus({ hasLive: data.hasLive, minutesUntilNext });
      } catch {
        // Silently fail
      }
    }

    fetchStatus();
    timer = setInterval(fetchStatus, 30000);
    return () => clearInterval(timer);
  }, []);

  return status;
}
```

- [ ] **Step 3: Update Sidebar — remove `nearLive`**

In `src/components/layout/Sidebar.tsx`:

Change the destructure on line 10:
```typescript
// Before:
const { hasLive, nearLive, minutesUntilNext } = useLiveStatus();
const liveClickable = hasLive || nearLive;

// After:
const { hasLive, minutesUntilNext } = useLiveStatus();
const liveClickable = hasLive;
```

Remove the amber pulse indicator around line 60:
```typescript
// DELETE this block:
{isLiveItem && nearLive && !hasLive && (
  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
)}
```

- [ ] **Step 4: Update BottomNav — remove `nearLive`**

In `src/components/layout/BottomNav.tsx`:

Same changes as Sidebar — change the destructure on line 10:
```typescript
// Before:
const { hasLive, nearLive, minutesUntilNext } = useLiveStatus();
const liveClickable = hasLive || nearLive;

// After:
const { hasLive, minutesUntilNext } = useLiveStatus();
const liveClickable = hasLive;
```

Remove the amber pulse indicator around line 59:
```typescript
// DELETE this block:
{isLiveItem && nearLive && !hasLive && (
  <span className="absolute top-0 right-1 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
)}
```

- [ ] **Step 5: Run existing nav tests**

Run: `npx vitest run src/components/layout/__tests__/BottomNav.test.tsx`
Expected: PASS

---

### Task 10: Update `/live` Page — No More `nearLive` Redirect

**Files:**
- Modify: `src/app/live/page.tsx`

- [ ] **Step 1: Rewrite the live redirect page**

Replace `src/app/live/page.tsx` contents:

```typescript
import { redirect } from 'next/navigation';
import { getLiveState } from '@/lib/live-state';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  const state = await getLiveState();

  if (state.liveMatchIds.length > 0) {
    redirect(`/match/${state.liveMatchIds[0]}/live`);
  }

  // No live match — redirect to home
  redirect('/');
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "live/page"`
Expected: No errors

---

### Task 11: Add `/api/today-matches` Route for Homepage Reactivity

**Files:**
- Create: `src/app/api/today-matches/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/today-matches/route.ts`:

```typescript
import { prisma, excludeSimData } from '@/lib/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value) - 1;
  const day = Number(parts.find((p) => p.type === 'day')!.value);
  const aestStartOfDay = new Date(Date.UTC(year, month, day) - 11 * 60 * 60 * 1000);
  const aestEndOfDay = new Date(Date.UTC(year, month, day + 1) - 10 * 60 * 60 * 1000);

  const matches = await prisma.match.findMany({
    where: {
      ...excludeSimData,
      scheduledAt: { gte: aestStartOfDay, lt: aestEndOfDay },
    },
    select: {
      id: true,
      status: true,
      homeScore: true,
      awayScore: true,
      currentQuarter: true,
      currentTime: true,
      scheduledAt: true,
    },
    orderBy: { scheduledAt: 'asc' },
  });

  return NextResponse.json(matches, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

---

### Task 12: Delete `match-sync.ts` and Update CLAUDE.md References

**Files:**
- Delete: `src/lib/match-sync.ts`
- Modify: `CLAUDE.md` (update references)

- [ ] **Step 1: Verify no remaining imports of `match-sync`**

Run a grep to confirm nothing still imports from `match-sync`:

```bash
npx vitest run 2>&1 | head -30
```

The new `worker.ts` imports from `processing.ts` instead. If anything still references `match-sync`, fix the import.

- [ ] **Step 2: Delete `match-sync.ts`**

Delete `src/lib/match-sync.ts`.

- [ ] **Step 3: Update CLAUDE.md**

In the **Live Tracking Pipeline** section of `CLAUDE.md`, update references:
- Replace mentions of `match-sync.ts` with `processing.ts`
- Add `ingestion.ts` and `broadcasting.ts` to the key functions list
- Update the `applyChanges()` description to note it's now in `processing.ts`
- Add mention of `live-state.ts` and `getLiveState()`
- Remove mention of `useLocalClock` from the Gotchas section
- Add note about PollLog table

---

### Task 13: Run Full Test Suite and Fix

**Files:** Various (fix any breakage)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`

- [ ] **Step 2: Fix any failing tests**

Common expected breakages:
- Tests that mock `@/lib/db` may need `pollLog` added to the mock
- Tests that reference `useLocalClock` need updating
- Tests that check for `nearLive` in component output need updating

Fix each failure, then re-run until all tests pass.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`

Fix any type errors.
