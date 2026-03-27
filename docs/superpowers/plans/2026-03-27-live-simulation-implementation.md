# Live Game Simulation System — Implementation Plan

> **Execution:** Use a **team of agents** to parallelize this plan. Track A and Track B are fully independent and should be assigned to separate teammates running concurrently. Track C depends on both completing first.

**Goal:** Build a controllable live game simulation system so the live scores page can be tested end-to-end without a real Champion Data match.

**Architecture:** A mock Champion Data API (Express routes) serves synthetic match data. The existing worker polls it via an env var toggle. An admin panel controls simulation speed and match state. Also fixes two missing Socket.io broadcasts.

**Tech Stack:** TypeScript, Express, Next.js 15 (App Router), Prisma, Socket.io, Vitest, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-27-live-simulation-design.md`

---

## Team Structure

Create a team with three agents:

| Agent | Track | Tasks | Description |
|-------|-------|-------|-------------|
| `pipeline-fixer` | A | Tasks 1-3 | Fix production Socket.io broadcasts and ScoreFlow persistence |
| `sim-builder` | B | Tasks 4-7 | Build simulation engine, data generator, and Express routes |
| `integrator` | C | Tasks 8-10 | Wire everything together, build admin panel, E2E test |

**Execution order:**
1. Launch `pipeline-fixer` and `sim-builder` **in parallel** — they touch completely different files
2. After both complete, launch `integrator` which depends on their output
3. Team lead reviews after each track completes

**Each agent gets:** Their track's tasks from this plan, plus the spec file path for reference.

---

## Track A: Pipeline Fixes (agent: `pipeline-fixer`)

### Task 1: Add `broadcastStatsUpdate` and `broadcastScoreFlowAdd` to socket-server

**Files:**
- Modify: `src/lib/socket-server.ts`
- Test: `src/__tests__/lib/socket-server.test.ts` (create)

- [ ] **Step 1: Write failing tests for the new broadcast functions**

Create `src/__tests__/lib/socket-server.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StatsUpdatePayload, ScoreFlowAddPayload } from '@/types/socket';

// Mock socket.io Server
const mockEmit = vi.fn();
const mockTo = vi.fn(() => ({ emit: mockEmit }));
const mockOn = vi.fn();

vi.mock('socket.io', () => ({
  Server: vi.fn(() => ({
    on: mockOn,
    to: mockTo,
  })),
}));

// Must import after mocks
import { initSocketServer, broadcastStatsUpdate, broadcastScoreFlowAdd } from '@/lib/socket-server';
import { createServer } from 'http';

describe('socket-server broadcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize the socket server so getIO() works
    const httpServer = createServer();
    initSocketServer(httpServer);
  });

  it('broadcastStatsUpdate emits stats:update to match room', () => {
    const payload: StatsUpdatePayload = {
      matchId: 'match-1',
      playerStats: [{
        playerId: 'player-1',
        goals: 5,
        attempts: 7,
        goalAssists: 2,
        intercepts: 0,
        deflections: 0,
        rebounds: 0,
        penalties: 1,
        feeds: 3,
        centrePassReceives: 0,
        turnovers: 1,
        minutesPlayed: 30,
      }],
    };

    broadcastStatsUpdate('match-1', payload);

    expect(mockTo).toHaveBeenCalledWith('match:match-1');
    expect(mockEmit).toHaveBeenCalledWith('stats:update', payload);
  });

  it('broadcastScoreFlowAdd emits scoreflow:add to match room', () => {
    const payload: ScoreFlowAddPayload = {
      matchId: 'match-1',
      period: 2,
      periodSeconds: 450,
      scoringTeamId: 'team-1',
      homeScore: 30,
      awayScore: 28,
    };

    broadcastScoreFlowAdd('match-1', payload);

    expect(mockTo).toHaveBeenCalledWith('match:match-1');
    expect(mockEmit).toHaveBeenCalledWith('scoreflow:add', payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/socket-server.test.ts`
Expected: FAIL — `broadcastStatsUpdate` and `broadcastScoreFlowAdd` are not exported from socket-server.

- [ ] **Step 3: Implement the two new broadcast functions**

In `src/lib/socket-server.ts`, add the imports and functions:

Add to the import block at line 7:
```typescript
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ScoreUpdatePayload,
  MatchStatusPayload,
  StatsUpdatePayload,
  ScoreFlowAddPayload,
} from '@/types/socket';
```

Add after the existing `broadcastMatchStatus` function (after line 58):
```typescript
export function broadcastStatsUpdate(matchId: string, payload: StatsUpdatePayload) {
  getIO().to(`match:${matchId}`).emit('stats:update', payload);
}

export function broadcastScoreFlowAdd(matchId: string, payload: ScoreFlowAddPayload) {
  getIO().to(`match:${matchId}`).emit('scoreflow:add', payload);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/socket-server.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All tests pass.

---

### Task 2: Add ScoreFlow persistence to match-sync

**Files:**
- Modify: `src/lib/match-sync.ts`
- Modify: `src/__tests__/lib/match-sync.test.ts`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add scoreFlow to the ChampionDataMatchState interface and write failing test**

Add to `src/__tests__/lib/match-sync.test.ts` — first update the mock to include ScoreFlow:

```typescript
vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    player: {
      findMany: vi.fn(),
    },
    playerMatchStats: {
      upsert: vi.fn(),
    },
    matchQuarter: {
      upsert: vi.fn(),
    },
    scoreFlow: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
```

Then add the new test after the existing tests:

```typescript
  it('should persist score flow entries in applyChanges', async () => {
    const { prisma } = await import('@/lib/db');
    const { applyChanges } = await import('@/lib/match-sync');

    const changes = {
      matchId: 'match-1',
      scoreChanged: true,
      statusChanged: false,
      newHomeScore: 32,
      newAwayScore: 28,
      newStatus: 'LIVE' as const,
      currentQuarter: 2,
      currentTime: '450',
    };

    const incoming = {
      matchId: 100,
      homeScore: 32,
      awayScore: 28,
      status: 'LIVE',
      currentQuarter: 2,
      currentTime: '450',
      scoreFlow: [
        {
          period: 1,
          periodSeconds: 200,
          squadId: 810,
          scorepoints: 1,
          homeScore: 15,
          awayScore: 14,
          scoringTeamPrismaId: 'team-home',
        },
        {
          period: 2,
          periodSeconds: 100,
          squadId: 811,
          scorepoints: 1,
          homeScore: 30,
          awayScore: 28,
          scoringTeamPrismaId: 'team-away',
        },
      ],
    };

    (prisma.match.update as any).mockResolvedValue({});
    (prisma.scoreFlow.upsert as any).mockResolvedValue({});

    await applyChanges(changes, incoming);

    expect(prisma.scoreFlow.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.scoreFlow.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          matchId_period_periodSeconds: {
            matchId: 'match-1',
            period: 1,
            periodSeconds: 200,
          },
        }),
      })
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/match-sync.test.ts`
Expected: FAIL — `scoreFlow` property not in incoming type / upsert not called.

- [ ] **Step 3: Add ScoreFlow persistence to match-sync.ts**

First, add `@@unique([matchId, period, periodSeconds])` to the ScoreFlow model in `prisma/schema.prisma`:

```prisma
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

  @@unique([matchId, period, periodSeconds])
  @@index([matchId, period])
}
```

Then apply the schema change and regenerate the client:

```bash
npx prisma db push
npx prisma generate
```

In `src/lib/match-sync.ts`, add `scoreFlow` to the `ChampionDataMatchState` interface:

```typescript
interface ChampionDataMatchState {
  matchId: number;
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
```

Add at the end of `applyChanges()`, after the player stats upsert block:

```typescript
  // Upsert score flow
  if (incoming.scoreFlow && incoming.scoreFlow.length > 0) {
    for (const sf of incoming.scoreFlow) {
      await prisma.scoreFlow.upsert({
        where: {
          matchId_period_periodSeconds: {
            matchId: changes.matchId,
            period: sf.period,
            periodSeconds: sf.periodSeconds,
          },
        },
        update: {
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
        },
        create: {
          matchId: changes.matchId,
          period: sf.period,
          periodSeconds: sf.periodSeconds,
          scoringTeamId: sf.scoringTeamPrismaId,
          homeScore: sf.homeScore,
          awayScore: sf.awayScore,
        },
      });
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/match-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

---

### Task 3: Wire stats and scoreflow broadcasts into the worker

**Files:**
- Modify: `src/lib/worker.ts`
- Modify: `src/__tests__/lib/worker.test.ts`

- [ ] **Step 1: Write failing test for simulation mode polling interval**

Add to `src/__tests__/lib/worker.test.ts`:

```typescript
  it('should return 2s when SIMULATION_MODE is true', async () => {
    vi.stubEnv('SIMULATION_MODE', 'true');
    // Re-import to pick up env change
    vi.resetModules();
    vi.mock('@/lib/match-sync', () => ({
      detectChanges: vi.fn(),
      applyChanges: vi.fn(),
    }));
    const { getPollingInterval } = await import('@/lib/worker');
    expect(getPollingInterval(true, true)).toBe(2_000);
    vi.unstubAllEnvs();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/worker.test.ts`
Expected: FAIL — returns 30000 instead of 2000.

- [ ] **Step 3: Add simulation mode override to getPollingInterval**

In `src/lib/worker.ts`, modify `getPollingInterval`:

```typescript
const POLL_SIM = 2_000; // 2 seconds in simulation mode

export function getPollingInterval(
  hasLiveMatch: boolean,
  isMatchDay: boolean
): number {
  if (process.env.SIMULATION_MODE === 'true') return POLL_SIM;
  if (hasLiveMatch) return POLL_LIVE;
  if (isMatchDay) return POLL_MATCH_DAY;
  return POLL_OFF_SEASON;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/worker.test.ts`
Expected: PASS

- [ ] **Step 5: Wire broadcastStatsUpdate and broadcastScoreFlowAdd into pollChampionData**

In `src/lib/worker.ts`, update the import:

```typescript
import {
  broadcastScoreUpdate,
  broadcastMatchStatus,
  broadcastStatsUpdate,
  broadcastScoreFlowAdd,
} from '@/lib/socket-server';
```

In the `pollChampionData` function, after the existing `broadcastMatchStatus` block (after line 94), add stats and scoreflow broadcasting:

```typescript
        // Broadcast player stats if available
        if (matchDetail.playerStats) {
          const allPlayerStats = [
            ...(matchDetail.playerStats.home ?? []),
            ...(matchDetail.playerStats.away ?? []),
          ];

          // Resolve CD player IDs to Prisma IDs for broadcast
          const players = await prisma.player.findMany({
            where: {
              championDataPlayerId: {
                in: allPlayerStats.map((ps) => ps.playerId),
              },
            },
            select: { id: true, championDataPlayerId: true },
          });
          const playerIdMap = new Map(
            players.map((p) => [p.championDataPlayerId, p.id]),
          );

          const statsPayload = allPlayerStats
            .filter((ps) => playerIdMap.has(ps.playerId))
            .map((ps) => ({
              playerId: playerIdMap.get(ps.playerId)!,
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
            }));

          if (statsPayload.length > 0) {
            broadcastStatsUpdate(changes.matchId, {
              matchId: changes.matchId,
              playerStats: statsPayload,
            });
          }
        }

        // Broadcast new score flow entries
        if (matchDetail.scoreFlow && matchDetail.scoreFlow.length > 0) {
          // Find the match's home team to resolve squad IDs
          const match = await prisma.match.findUnique({
            where: { id: changes.matchId },
            include: { homeTeam: true, awayTeam: true },
          });

          if (match) {
            for (const sf of matchDetail.scoreFlow) {
              const scoringTeamId =
                sf.squadId === match.homeTeam.championDataTeamId
                  ? match.homeTeamId
                  : match.awayTeamId;

              broadcastScoreFlowAdd(changes.matchId, {
                matchId: changes.matchId,
                period: sf.period,
                periodSeconds: sf.periodSeconds,
                scoringTeamId,
                homeScore: sf.homeScore,
                awayScore: sf.awayScore,
              });
            }
          }
        }
```

Also pass scoreFlow data through to `applyChanges`. Replace the existing `incoming` object construction (lines 63-70) and the code through `applyChanges` with:

```typescript
      // Resolve team IDs for score flow
      const dbMatch = await prisma.match.findUnique({
        where: { championDataMatchId: matchData.matchId },
        include: { homeTeam: true, awayTeam: true },
      });

      const incoming = {
        matchId: matchData.matchId,
        homeScore: matchDetail.matchInfo?.homeScore ?? 0,
        awayScore: matchDetail.matchInfo?.awayScore ?? 0,
        status: mapMatchStatus(matchData.matchStatus),
        currentQuarter: matchDetail.matchInfo?.period ?? 0,
        currentTime: `${matchDetail.matchInfo?.periodSeconds ?? 0}`,
        quarterScores: matchDetail.periodScores?.map((ps) => ({
          quarter: ps.period,
          homeScore: ps.homeScore,
          awayScore: ps.awayScore,
        })),
        playerStats: matchDetail.playerStats
          ? [
              ...(matchDetail.playerStats.home ?? []),
              ...(matchDetail.playerStats.away ?? []),
            ].map((ps) => ({
              championDataPlayerId: ps.playerId,
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
            }))
          : undefined,
        scoreFlow: matchDetail.scoreFlow && dbMatch
          ? matchDetail.scoreFlow.map((sf) => ({
              period: sf.period,
              periodSeconds: sf.periodSeconds,
              squadId: sf.squadId,
              scorepoints: sf.scorepoints,
              homeScore: sf.homeScore,
              awayScore: sf.awayScore,
              scoringTeamPrismaId:
                sf.squadId === dbMatch.homeTeam.championDataTeamId
                  ? dbMatch.homeTeamId
                  : dbMatch.awayTeamId,
            }))
          : undefined,
      };

      const changes = await detectChanges(incoming);
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

---

## Track B: Simulation Engine (agent: `sim-builder`)

### Task 4: Define simulation types

**Files:**
- Create: `src/lib/simulation/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/lib/simulation/types.ts`:

```typescript
export type SimMatchState =
  | 'pre-match'
  | 'q1-active'
  | 'q1-break'
  | 'q2-active'
  | 'q2-break'
  | 'q3-active'
  | 'q3-break'
  | 'q4-active'
  | 'match-complete';

export interface SimPlayer {
  championDataPlayerId: number;
  name: string;
  position: string; // GS, GA, WA, C, WD, GD, GK
  squadId: number;
}

export interface SimScoreFlowEntry {
  period: number;
  periodSeconds: number;
  squadId: number;
  scorepoints: number;
  homeScore: number;
  awayScore: number;
}

export interface SimPlayerStats {
  playerId: number; // championDataPlayerId
  displayName: string;
  position: string;
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

export interface SimMatch {
  matchIndex: number;
  championDataMatchId: number; // fake ID: 99001, 99002, ...
  prismaMatchId: string; // created Match record ID
  state: SimMatchState;
  homeSquadId: number;
  homeSquadName: string;
  homeSquadCode: string;
  awaySquadId: number;
  awaySquadName: string;
  awaySquadCode: string;
  homeScore: number;
  awayScore: number;
  period: number;
  periodSeconds: number;
  tickCount: number;
  scoreFlow: SimScoreFlowEntry[];
  playerStats: SimPlayerStats[];
  homePlayers: SimPlayer[];
  awayPlayers: SimPlayer[];
  venue: string;
  startOffset: number; // ticks to delay before starting
}

export interface SimConfig {
  matchCount: number;
  speed: number; // multiplier: 1, 2, 5, 10, 50
  tickStep: number; // game-seconds per tick (default 30)
}

export interface SimState {
  running: boolean;
  paused: boolean;
  config: SimConfig;
  matches: SimMatch[];
  log: SimLogEntry[];
}

export interface SimLogEntry {
  timestamp: number;
  matchIndex: number;
  message: string;
}

/** State transition map */
export const STATE_ORDER: SimMatchState[] = [
  'pre-match',
  'q1-active',
  'q1-break',
  'q2-active',
  'q2-break',
  'q3-active',
  'q3-break',
  'q4-active',
  'match-complete',
];

/** Map state to Champion Data matchStatus */
export function stateToMatchStatus(state: SimMatchState): string {
  if (state === 'pre-match') return 'scheduled';
  if (state === 'match-complete') return 'complete';
  return 'playing';
}

/** Map state to period number */
export function stateToPeriod(state: SimMatchState): number {
  const map: Record<SimMatchState, number> = {
    'pre-match': 0,
    'q1-active': 1, 'q1-break': 1,
    'q2-active': 2, 'q2-break': 2,
    'q3-active': 3, 'q3-break': 3,
    'q4-active': 4,
    'match-complete': 4,
  };
  return map[state];
}

/** Is this an active (scoring) state? */
export function isActiveState(state: SimMatchState): boolean {
  return state.endsWith('-active');
}

/** Is this a break state? */
export function isBreakState(state: SimMatchState): boolean {
  return state.endsWith('-break');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty src/lib/simulation/types.ts 2>&1 | head -20`

If there are path alias issues, just verify the file has no syntax errors:
Run: `npx tsx -e "import('./src/lib/simulation/types.ts').then(() => console.log('OK'))"`

---

### Task 5: Build the simulation engine (state machine + scoring)

**Files:**
- Create: `src/lib/simulation/engine.ts`
- Test: `src/__tests__/lib/simulation/engine.test.ts` (create)

- [ ] **Step 1: Write failing tests for state transitions and scoring**

Create `src/__tests__/lib/simulation/engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SimMatch, SimState } from '@/lib/simulation/types';

// Mock prisma for DB setup
vi.mock('@/lib/db', () => ({
  prisma: {
    team: { findMany: vi.fn() },
    player: { findMany: vi.fn() },
    match: { create: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    competition: { findFirst: vi.fn() },
    matchQuarter: { deleteMany: vi.fn() },
    playerMatchStats: { deleteMany: vi.fn() },
    scoreFlow: { deleteMany: vi.fn() },
  },
}));

import {
  createSimState,
  tickMatch,
  advanceState,
  generateGoals,
} from '@/lib/simulation/engine';

describe('simulation engine', () => {
  describe('createSimState', () => {
    it('creates a SimState with default config', () => {
      const state = createSimState({ matchCount: 2, speed: 1, tickStep: 30 });
      expect(state.running).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.config.matchCount).toBe(2);
      expect(state.matches).toEqual([]);
    });
  });

  describe('advanceState', () => {
    it('transitions from pre-match to q1-active', () => {
      expect(advanceState('pre-match')).toBe('q1-active');
    });

    it('transitions from q1-active to q1-break', () => {
      expect(advanceState('q1-active')).toBe('q1-break');
    });

    it('transitions from q4-active to match-complete', () => {
      expect(advanceState('q4-active')).toBe('match-complete');
    });

    it('does not advance past match-complete', () => {
      expect(advanceState('match-complete')).toBe('match-complete');
    });
  });

  describe('tickMatch', () => {
    function makeMatch(overrides: Partial<SimMatch> = {}): SimMatch {
      return {
        matchIndex: 0,
        championDataMatchId: 99001,
        prismaMatchId: 'match-1',
        state: 'q1-active',
        homeSquadId: 810,
        homeSquadName: 'Melbourne Vixens',
        homeSquadCode: 'VIX',
        awaySquadId: 811,
        awaySquadName: 'West Coast Fever',
        awaySquadCode: 'FEV',
        homeScore: 0,
        awayScore: 0,
        period: 1,
        periodSeconds: 0,
        tickCount: 0,
        scoreFlow: [],
        playerStats: [],
        homePlayers: [],
        awayPlayers: [],
        venue: 'John Cain Arena',
        startOffset: 0,
        ...overrides,
      };
    }

    it('advances periodSeconds by tickStep in active state', () => {
      const match = makeMatch({ state: 'q1-active', periodSeconds: 0 });
      const result = tickMatch(match, 30);
      expect(result.periodSeconds).toBe(30);
      expect(result.tickCount).toBe(1);
    });

    it('transitions to break when periodSeconds reaches 900', () => {
      const match = makeMatch({ state: 'q1-active', periodSeconds: 880 });
      const result = tickMatch(match, 30);
      expect(result.state).toBe('q1-break');
      expect(result.periodSeconds).toBe(900);
    });

    it('does not advance periodSeconds in break state', () => {
      const match = makeMatch({ state: 'q1-break', periodSeconds: 900 });
      const result = tickMatch(match, 30);
      expect(result.periodSeconds).toBe(900);
      // Break lasts 2 ticks, so first tick stays in break
      expect(result.state).toBe('q1-break');
    });

    it('transitions from break to next quarter after 2 ticks', () => {
      const match = makeMatch({
        state: 'q1-break',
        periodSeconds: 900,
        tickCount: 1, // second tick in break
      });
      // Tick once — this is the "2nd break tick"
      const tick1 = tickMatch(match, 30);
      const tick2 = tickMatch(tick1, 30);
      expect(tick2.state).toBe('q2-active');
      expect(tick2.periodSeconds).toBe(0);
    });

    it('does not change match-complete state', () => {
      const match = makeMatch({ state: 'match-complete' });
      const result = tickMatch(match, 30);
      expect(result.state).toBe('match-complete');
    });

    it('respects startOffset — does not advance until offset reached', () => {
      const match = makeMatch({ state: 'pre-match', startOffset: 3, tickCount: 0 });
      const tick1 = tickMatch(match, 30);
      expect(tick1.state).toBe('pre-match');
      expect(tick1.tickCount).toBe(1);
    });
  });

  describe('generateGoals', () => {
    it('returns 0-2 goals for a team per tick', () => {
      // Run many iterations to check bounds
      const results = new Set<number>();
      for (let i = 0; i < 1000; i++) {
        results.add(generateGoals());
      }
      // Should only produce 0, 1, or 2
      for (const r of results) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(2);
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/simulation/engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the simulation engine**

Create `src/lib/simulation/engine.ts`:

```typescript
import { prisma } from '@/lib/db';
import type {
  SimState,
  SimMatch,
  SimMatchState,
  SimConfig,
  SimLogEntry,
  SimPlayer,
  SimPlayerStats,
  SimScoreFlowEntry,
} from './types';
import { STATE_ORDER, isActiveState, isBreakState, stateToPeriod } from './types';

// ───── State management ─────

export function createSimState(config: SimConfig): SimState {
  return {
    running: false,
    paused: false,
    config,
    matches: [],
    log: [],
  };
}

export function advanceState(current: SimMatchState): SimMatchState {
  const idx = STATE_ORDER.indexOf(current);
  if (idx === -1 || idx >= STATE_ORDER.length - 1) return current;
  return STATE_ORDER[idx + 1];
}

// ───── Scoring ─────

export function generateGoals(): number {
  const rand = Math.random();
  if (rand < 0.50) return 0;
  if (rand < 0.90) return 1;
  return 2;
}

function isSuperShot(state: SimMatchState): boolean {
  return state === 'q4-active' && Math.random() < 0.15;
}

function generatePlayerStatsForTick(
  match: SimMatch,
  homeGoals: number,
  awayGoals: number,
): SimPlayerStats[] {
  const stats = [...match.playerStats];

  // Distribute goals to shooters
  const distributeGoals = (players: SimPlayer[], goals: number, squadId: number) => {
    const shooters = players.filter((p) => p.position === 'GS' || p.position === 'GA');
    if (shooters.length === 0 || goals === 0) return;

    for (let i = 0; i < goals; i++) {
      const shooter = shooters[Math.floor(Math.random() * shooters.length)];
      const stat = stats.find(
        (s) => s.playerId === shooter.championDataPlayerId,
      );
      if (stat) {
        stat.goals += 1;
        stat.attempts += 1;
        // Sometimes miss too (to get 70-85% accuracy)
        if (Math.random() < 0.2) stat.attempts += 1;
      }
    }

    // Distribute assists to midcourt
    const feeders = players.filter((p) =>
      ['WA', 'C', 'GA'].includes(p.position),
    );
    for (const feeder of feeders) {
      const stat = stats.find(
        (s) => s.playerId === feeder.championDataPlayerId,
      );
      if (stat && goals > 0) {
        stat.feeds += Math.ceil(goals * 0.7);
        stat.goalAssists += Math.floor(goals * 0.5);
        stat.centrePassReceives += Math.random() < 0.4 ? 1 : 0;
      }
    }

    // Distribute defensive stats
    const defenders = players.filter((p) =>
      ['GD', 'GK', 'WD'].includes(p.position),
    );
    for (const def of defenders) {
      const stat = stats.find(
        (s) => s.playerId === def.championDataPlayerId,
      );
      if (stat) {
        stat.intercepts += Math.random() < 0.3 ? 1 : 0;
        stat.deflections += Math.random() < 0.25 ? 1 : 0;
        stat.rebounds += Math.random() < 0.15 ? 1 : 0;
      }
    }

    // Small chance of turnovers and penalties for all
    for (const player of players) {
      const stat = stats.find(
        (s) => s.playerId === player.championDataPlayerId,
      );
      if (stat) {
        stat.turnovers += Math.random() < 0.1 ? 1 : 0;
        stat.penalties += Math.random() < 0.05 ? 1 : 0;
        stat.minutesPlayed += 0.5; // half a minute per tick
      }
    }
  };

  distributeGoals(match.homePlayers, homeGoals, match.homeSquadId);
  distributeGoals(match.awayPlayers, awayGoals, match.awaySquadId);

  return stats;
}

// ───── Tick logic ─────

/** Track break ticks per match (not serialized — lives in engine memory) */
const breakTickCounts = new Map<number, number>();

export function tickMatch(match: SimMatch, tickStep: number): SimMatch {
  const updated = { ...match, tickCount: match.tickCount + 1 };

  // Respect start offset
  if (updated.state === 'pre-match') {
    if (updated.tickCount >= updated.startOffset) {
      updated.state = 'q1-active';
      updated.period = 1;
      updated.periodSeconds = 0;
    }
    return updated;
  }

  // Match complete — no changes
  if (updated.state === 'match-complete') {
    return updated;
  }

  // Break state — count break ticks, advance after 2
  if (isBreakState(updated.state)) {
    const key = updated.championDataMatchId;
    const count = (breakTickCounts.get(key) ?? 0) + 1;
    breakTickCounts.set(key, count);

    if (count >= 2) {
      breakTickCounts.delete(key);
      updated.state = advanceState(updated.state);
      updated.period = stateToPeriod(updated.state);
      updated.periodSeconds = 0;
    }
    return updated;
  }

  // Active state — advance time, maybe score
  if (isActiveState(updated.state)) {
    updated.periodSeconds = Math.min(updated.periodSeconds + tickStep, 900);

    // Generate scoring
    const homeGoals = generateGoals();
    const awayGoals = generateGoals();

    for (let i = 0; i < homeGoals; i++) {
      const points = isSuperShot(updated.state) ? 2 : 1;
      updated.homeScore += points;
      updated.scoreFlow = [
        ...updated.scoreFlow,
        {
          period: updated.period,
          periodSeconds: updated.periodSeconds,
          squadId: updated.homeSquadId,
          scorepoints: points,
          homeScore: updated.homeScore,
          awayScore: updated.awayScore,
        },
      ];
    }

    for (let i = 0; i < awayGoals; i++) {
      const points = isSuperShot(updated.state) ? 2 : 1;
      updated.awayScore += points;
      updated.scoreFlow = [
        ...updated.scoreFlow,
        {
          period: updated.period,
          periodSeconds: updated.periodSeconds,
          squadId: updated.awaySquadId,
          scorepoints: points,
          homeScore: updated.homeScore,
          awayScore: updated.awayScore,
        },
      ];
    }

    // Update player stats
    updated.playerStats = generatePlayerStatsForTick(updated, homeGoals, awayGoals);

    // Transition if quarter over
    if (updated.periodSeconds >= 900) {
      updated.state = advanceState(updated.state);
      if (isBreakState(updated.state)) {
        breakTickCounts.set(updated.championDataMatchId, 0);
      }
    }
  }

  return updated;
}

// ───── Database setup/teardown ─────

export async function setupSimMatches(
  matchCount: number,
): Promise<SimMatch[]> {
  const competition = await prisma.competition.findFirst();
  if (!competition) throw new Error('No competition found in DB');

  const teams = await prisma.team.findMany({
    where: { championDataTeamId: { not: null } },
    include: {
      players: {
        where: { championDataPlayerId: { not: null } },
        select: {
          championDataPlayerId: true,
          name: true,
          position: true,
          teamId: true,
        },
      },
    },
  });

  if (teams.length < 2) throw new Error('Need at least 2 teams in DB');

  // Shuffle teams and pair them
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const venues = [
    'John Cain Arena',
    'Ken Rosewall Arena',
    'RAC Arena',
    'Adelaide Entertainment Centre',
  ];

  const matches: SimMatch[] = [];

  for (let i = 0; i < matchCount && i * 2 + 1 < shuffled.length; i++) {
    const home = shuffled[i * 2];
    const away = shuffled[i * 2 + 1];

    const cdMatchId = 99001 + i;

    // Create temp Match record in DB
    const dbMatch = await prisma.match.create({
      data: {
        competitionId: competition.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        round: 99,
        venue: venues[i % venues.length],
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        homeScore: 0,
        awayScore: 0,
        championDataMatchId: cdMatchId,
      },
    });

    const homePlayers: SimPlayer[] = home.players.slice(0, 7).map((p) => ({
      championDataPlayerId: p.championDataPlayerId!,
      name: p.name,
      position: p.position,
      squadId: home.championDataTeamId!,
    }));

    const awayPlayers: SimPlayer[] = away.players.slice(0, 7).map((p) => ({
      championDataPlayerId: p.championDataPlayerId!,
      name: p.name,
      position: p.position,
      squadId: away.championDataTeamId!,
    }));

    // Initialize player stats
    const initStats = (players: SimPlayer[]): SimPlayerStats[] =>
      players.map((p) => ({
        playerId: p.championDataPlayerId,
        displayName: p.name,
        position: p.position,
        squadId: p.squadId,
        goals: 0,
        attempts: 0,
        goalAssists: 0,
        intercepts: 0,
        deflections: 0,
        rebounds: 0,
        penalties: 0,
        feeds: 0,
        centrePassReceives: 0,
        turnovers: 0,
        minutesPlayed: 0,
      }));

    matches.push({
      matchIndex: i,
      championDataMatchId: cdMatchId,
      prismaMatchId: dbMatch.id,
      state: 'pre-match',
      homeSquadId: home.championDataTeamId!,
      homeSquadName: home.name,
      homeSquadCode: home.abbreviation,
      awaySquadId: away.championDataTeamId!,
      awaySquadName: away.name,
      awaySquadCode: away.abbreviation,
      homeScore: 0,
      awayScore: 0,
      period: 0,
      periodSeconds: 0,
      tickCount: 0,
      scoreFlow: [],
      playerStats: [...initStats(homePlayers), ...initStats(awayPlayers)],
      homePlayers,
      awayPlayers,
      venue: venues[i % venues.length],
      startOffset: i * 5, // stagger by 5 ticks
    });
  }

  return matches;
}

export async function teardownSimMatches(matches: SimMatch[]): Promise<void> {
  for (const match of matches) {
    // Delete associated records first (no cascade by default)
    await prisma.scoreFlow.deleteMany({
      where: { matchId: match.prismaMatchId },
    });
    await prisma.playerMatchStats.deleteMany({
      where: { matchId: match.prismaMatchId },
    });
    await prisma.matchQuarter.deleteMany({
      where: { matchId: match.prismaMatchId },
    });
    await prisma.match.delete({
      where: { id: match.prismaMatchId },
    });
  }
}

// ───── Tick all matches ─────

export function tickAllMatches(state: SimState): SimState {
  const updated = { ...state };
  updated.matches = state.matches.map((m) => {
    const ticked = tickMatch(m, state.config.tickStep);
    // Log state transitions
    if (ticked.state !== m.state) {
      updated.log = [
        ...updated.log,
        {
          timestamp: Date.now(),
          matchIndex: m.matchIndex,
          message: `${m.homeSquadName} vs ${m.awaySquadName}: ${m.state} → ${ticked.state}`,
        },
      ];
    }
    // Log goals
    if (ticked.homeScore !== m.homeScore || ticked.awayScore !== m.awayScore) {
      updated.log = [
        ...updated.log,
        {
          timestamp: Date.now(),
          matchIndex: m.matchIndex,
          message: `Score: ${ticked.homeSquadName} ${ticked.homeScore} - ${ticked.awayScore} ${ticked.awaySquadName}`,
        },
      ];
    }
    return ticked;
  });
  // Keep last 100 log entries
  if (updated.log.length > 100) {
    updated.log = updated.log.slice(-100);
  }
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/simulation/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

---

### Task 6: Build the data generator (CD-format response builders)

**Files:**
- Create: `src/lib/simulation/data-generator.ts`
- Test: `src/__tests__/lib/simulation/data-generator.test.ts` (create)

- [ ] **Step 1: Write failing tests for data generators**

Create `src/__tests__/lib/simulation/data-generator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { SimMatch, SimState } from '@/lib/simulation/types';
import { buildFixtureResponse, buildMatchStatsResponse } from '@/lib/simulation/data-generator';

function makeSimMatch(overrides: Partial<SimMatch> = {}): SimMatch {
  return {
    matchIndex: 0,
    championDataMatchId: 99001,
    prismaMatchId: 'match-1',
    state: 'q2-active',
    homeSquadId: 810,
    homeSquadName: 'Melbourne Vixens',
    homeSquadCode: 'VIX',
    awaySquadId: 811,
    awaySquadName: 'West Coast Fever',
    awaySquadCode: 'FEV',
    homeScore: 30,
    awayScore: 28,
    period: 2,
    periodSeconds: 450,
    tickCount: 20,
    scoreFlow: [
      { period: 1, periodSeconds: 100, squadId: 810, scorepoints: 1, homeScore: 1, awayScore: 0 },
      { period: 1, periodSeconds: 200, squadId: 811, scorepoints: 1, homeScore: 1, awayScore: 1 },
    ],
    playerStats: [
      {
        playerId: 1001, displayName: 'Test Player', position: 'GS', squadId: 810,
        goals: 5, attempts: 7, goalAssists: 0, intercepts: 0, deflections: 0,
        rebounds: 0, penalties: 0, feeds: 1, centrePassReceives: 0, turnovers: 1, minutesPlayed: 15,
      },
    ],
    homePlayers: [{ championDataPlayerId: 1001, name: 'Test Player', position: 'GS', squadId: 810 }],
    awayPlayers: [],
    venue: 'John Cain Arena',
    startOffset: 0,
    ...overrides,
  };
}

describe('data-generator', () => {
  describe('buildFixtureResponse', () => {
    it('returns CDFixtureResponse shape', () => {
      const matches = [makeSimMatch()];
      const result = buildFixtureResponse(matches);

      expect(result).toHaveProperty('fixture');
      expect(result.fixture).toHaveProperty('jobId');
      expect(result.fixture).toHaveProperty('match');
      expect(result.fixture.match).toHaveLength(1);
    });

    it('maps matchStatus correctly for playing state', () => {
      const matches = [makeSimMatch({ state: 'q2-active' })];
      const result = buildFixtureResponse(matches);
      expect(result.fixture.match[0].matchStatus).toBe('playing');
    });

    it('maps matchStatus correctly for scheduled state', () => {
      const matches = [makeSimMatch({ state: 'pre-match' })];
      const result = buildFixtureResponse(matches);
      expect(result.fixture.match[0].matchStatus).toBe('scheduled');
    });

    it('maps matchStatus correctly for complete state', () => {
      const matches = [makeSimMatch({ state: 'match-complete' })];
      const result = buildFixtureResponse(matches);
      expect(result.fixture.match[0].matchStatus).toBe('complete');
    });

    it('includes correct squad IDs and scores', () => {
      const matches = [makeSimMatch()];
      const result = buildFixtureResponse(matches);
      const m = result.fixture.match[0];
      expect(m.homeSquadId).toBe(810);
      expect(m.awaySquadId).toBe(811);
      expect(m.homeSquadScore).toBe(30);
      expect(m.awaySquadScore).toBe(28);
    });
  });

  describe('buildMatchStatsResponse', () => {
    it('returns CDMatchStatsResponse shape', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);

      expect(result).toHaveProperty('matchInfo');
      expect(result).toHaveProperty('scoreFlow');
      expect(result).toHaveProperty('playerStats');
      expect(result).toHaveProperty('periodScores');
      expect(result).toHaveProperty('teamStats');
    });

    it('has correct matchInfo values', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);

      expect(result.matchInfo.matchId).toBe(99001);
      expect(result.matchInfo.homeScore).toBe(30);
      expect(result.matchInfo.awayScore).toBe(28);
      expect(result.matchInfo.period).toBe(2);
      expect(result.matchInfo.periodSeconds).toBe(450);
    });

    it('includes score flow entries', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);
      expect(result.scoreFlow).toHaveLength(2);
    });

    it('splits playerStats into home and away', () => {
      const match = makeSimMatch();
      const result = buildMatchStatsResponse(match);
      expect(result.playerStats).toHaveProperty('home');
      expect(result.playerStats).toHaveProperty('away');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/simulation/data-generator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the data generator**

Create `src/lib/simulation/data-generator.ts`:

```typescript
import type {
  CDFixtureResponse,
  CDFixtureMatch,
  CDMatchStatsResponse,
  CDMatchInfo,
  CDScoreFlowEntry,
  CDPlayerStats,
  CDTeamStats,
  CDPeriodScore,
} from '@/types/champion-data';
import type { SimMatch } from './types';
import { stateToMatchStatus, stateToPeriod } from './types';

export function buildFixtureResponse(matches: SimMatch[]): CDFixtureResponse {
  const now = new Date().toISOString();

  return {
    fixture: {
      jobId: 99999,
      match: matches.map((m): CDFixtureMatch => ({
        matchId: m.championDataMatchId,
        matchNumber: m.matchIndex + 1,
        matchType: 'Regular',
        roundNumber: 99,
        homeSquadId: m.homeSquadId,
        homeSquadName: m.homeSquadName,
        homeSquadCode: m.homeSquadCode,
        homeSquadShortCode: m.homeSquadCode,
        homeSquadNickname: m.homeSquadName.split(' ').pop() ?? m.homeSquadName,
        homeSquadScore: m.homeScore,
        awaySquadId: m.awaySquadId,
        awaySquadName: m.awaySquadName,
        awaySquadCode: m.awaySquadCode,
        awaySquadShortCode: m.awaySquadCode,
        awaySquadNickname: m.awaySquadName.split(' ').pop() ?? m.awaySquadName,
        awaySquadScore: m.awayScore,
        venue: m.venue,
        venueName: m.venue,
        venueId: 100 + m.matchIndex,
        venueCode: m.venue.substring(0, 3).toUpperCase(),
        localStartTime: now,
        utcStartTime: now,
        matchStatus: stateToMatchStatus(m.state),
        period: stateToPeriod(m.state),
        periodSecs: m.periodSeconds,
        periodCompleted: Math.max(0, stateToPeriod(m.state) - 1),
        isNetball2pt: true,
        finalCode: '',
        finalShortCode: '',
      })),
    },
  };
}

export function buildMatchStatsResponse(match: SimMatch): CDMatchStatsResponse {
  const homePlayerStats = match.playerStats.filter(
    (ps) => ps.squadId === match.homeSquadId,
  );
  const awayPlayerStats = match.playerStats.filter(
    (ps) => ps.squadId === match.awaySquadId,
  );

  const toCDPlayerStats = (ps: typeof match.playerStats[number]): CDPlayerStats => ({
    playerId: ps.playerId,
    displayName: ps.displayName,
    position: ps.position,
    squadId: ps.squadId,
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
  });

  const aggregateTeamStats = (
    players: typeof match.playerStats,
    squadId: number,
  ): CDTeamStats => ({
    squadId,
    goals: players.reduce((sum, p) => sum + p.goals, 0),
    attempts: players.reduce((sum, p) => sum + p.attempts, 0),
    goalAssists: players.reduce((sum, p) => sum + p.goalAssists, 0),
    intercepts: players.reduce((sum, p) => sum + p.intercepts, 0),
    deflections: players.reduce((sum, p) => sum + p.deflections, 0),
    rebounds: players.reduce((sum, p) => sum + p.rebounds, 0),
    penalties: players.reduce((sum, p) => sum + p.penalties, 0),
    feeds: players.reduce((sum, p) => sum + p.feeds, 0),
    centrePassReceives: players.reduce((sum, p) => sum + p.centrePassReceives, 0),
    turnovers: players.reduce((sum, p) => sum + p.turnovers, 0),
  });

  // Build period scores from score flow
  const periodScores: CDPeriodScore[] = [];
  const currentPeriod = stateToPeriod(match.state);
  for (let p = 1; p <= currentPeriod; p++) {
    const periodFlow = match.scoreFlow.filter((sf) => sf.period === p);
    const lastEntry = periodFlow[periodFlow.length - 1];
    if (lastEntry) {
      periodScores.push({
        period: p,
        homeScore: lastEntry.homeScore,
        awayScore: lastEntry.awayScore,
      });
    } else {
      // Period with no scoring events yet
      const prevPeriod = periodScores[periodScores.length - 1];
      periodScores.push({
        period: p,
        homeScore: prevPeriod?.homeScore ?? 0,
        awayScore: prevPeriod?.awayScore ?? 0,
      });
    }
  }

  const matchInfo: CDMatchInfo = {
    matchId: match.championDataMatchId,
    round: 99,
    venue: match.venue,
    homeSquadId: match.homeSquadId,
    homeSquadName: match.homeSquadName,
    awaySquadId: match.awaySquadId,
    awaySquadName: match.awaySquadName,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    matchStatus: stateToMatchStatus(match.state),
    period: stateToPeriod(match.state),
    periodSeconds: match.periodSeconds,
  };

  const scoreFlow: CDScoreFlowEntry[] = match.scoreFlow.map((sf) => ({
    period: sf.period,
    periodSeconds: sf.periodSeconds,
    squadId: sf.squadId,
    scorepoints: sf.scorepoints,
    homeScore: sf.homeScore,
    awayScore: sf.awayScore,
  }));

  return {
    matchInfo,
    scoreFlow,
    teamStats: {
      home: aggregateTeamStats(homePlayerStats, match.homeSquadId),
      away: aggregateTeamStats(awayPlayerStats, match.awaySquadId),
    },
    playerStats: {
      home: homePlayerStats.map(toCDPlayerStats),
      away: awayPlayerStats.map(toCDPlayerStats),
    },
    periodScores,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/simulation/data-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

---

### Task 7: Build the Express simulation routes

**Files:**
- Create: `src/lib/simulation/sim-routes.ts`

- [ ] **Step 1: Implement the simulation routes**

Create `src/lib/simulation/sim-routes.ts`:

```typescript
import { Router, json } from 'express';
import type { SimState, SimMatchState } from './types';
import {
  createSimState,
  setupSimMatches,
  teardownSimMatches,
  tickAllMatches,
  tickMatch,
} from './engine';
import { buildFixtureResponse, buildMatchStatsResponse } from './data-generator';
import { STATE_ORDER } from './types';

const router = Router();
router.use(json());

let simState: SimState = createSimState({ matchCount: 2, speed: 1, tickStep: 30 });
let tickTimer: ReturnType<typeof setInterval> | null = null;

function getTickIntervalMs(): number {
  const baseInterval = 30_000; // 30s at 1x
  return baseInterval / simState.config.speed;
}

function startAutoTick(): void {
  stopAutoTick();
  tickTimer = setInterval(() => {
    if (!simState.paused && simState.running) {
      simState = tickAllMatches(simState);
    }
  }, getTickIntervalMs());
}

function stopAutoTick(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// ───── Data endpoints (polled by worker) ─────

router.get('/fixture.json', (_req, res) => {
  const response = buildFixtureResponse(simState.matches);
  res.json(response);
});

router.get('/:matchId.json', (req, res) => {
  const matchId = parseInt(req.params.matchId, 10);
  const match = simState.matches.find((m) => m.championDataMatchId === matchId);

  if (!match) {
    res.status(404).json({ error: 'Simulated match not found' });
    return;
  }

  const response = buildMatchStatsResponse(match);
  res.json(response);
});

// ───── Control endpoint ─────

router.post('/control', async (req, res) => {
  const { action, ...params } = req.body;

  switch (action) {
    case 'start': {
      if (simState.running) {
        res.status(400).json({ error: 'Simulation already running' });
        return;
      }
      const matchCount = params.matchCount ?? 2;
      simState = createSimState({
        matchCount,
        speed: params.speed ?? 1,
        tickStep: params.tickStep ?? 30,
      });
      simState.matches = await setupSimMatches(matchCount);
      simState.running = true;
      simState.log.push({
        timestamp: Date.now(),
        matchIndex: -1,
        message: `Simulation started with ${matchCount} match(es)`,
      });
      startAutoTick();
      res.json({ ok: true, matches: simState.matches.length });
      return;
    }

    case 'stop': {
      stopAutoTick();
      if (simState.matches.length > 0) {
        await teardownSimMatches(simState.matches);
      }
      simState = createSimState({ matchCount: 2, speed: 1, tickStep: 30 });
      res.json({ ok: true });
      return;
    }

    case 'pause': {
      simState.paused = true;
      res.json({ ok: true });
      return;
    }

    case 'resume': {
      simState.paused = false;
      res.json({ ok: true });
      return;
    }

    case 'step': {
      simState = tickAllMatches(simState);
      res.json({ ok: true });
      return;
    }

    case 'goto': {
      const { matchIndex, state } = params as {
        matchIndex: number;
        state: SimMatchState;
      };
      if (!STATE_ORDER.includes(state)) {
        res.status(400).json({ error: `Invalid state: ${state}` });
        return;
      }
      const match = simState.matches[matchIndex];
      if (!match) {
        res.status(400).json({ error: `Invalid matchIndex: ${matchIndex}` });
        return;
      }
      // Jump to state — reset periodSeconds for active states
      match.state = state;
      match.period = STATE_ORDER.indexOf(state) <= 0 ? 0 : Math.ceil(STATE_ORDER.indexOf(state) / 2);
      match.periodSeconds = state.endsWith('-active') ? 0 : state.endsWith('-break') ? 900 : 0;
      simState.log.push({
        timestamp: Date.now(),
        matchIndex,
        message: `Jumped to ${state}`,
      });
      res.json({ ok: true });
      return;
    }

    case 'speed': {
      const { multiplier } = params as { multiplier: number };
      if (![1, 2, 5, 10, 50].includes(multiplier)) {
        res.status(400).json({ error: `Invalid speed: ${multiplier}` });
        return;
      }
      simState.config.speed = multiplier;
      if (simState.running) {
        startAutoTick(); // restart with new interval
      }
      res.json({ ok: true, speed: multiplier });
      return;
    }

    default:
      res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

// ───── Status endpoint ─────

router.get('/status', (_req, res) => {
  res.json({
    running: simState.running,
    paused: simState.paused,
    speed: simState.config.speed,
    matches: simState.matches.map((m) => ({
      matchIndex: m.matchIndex,
      state: m.state,
      homeTeam: m.homeSquadName,
      awayTeam: m.awaySquadName,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      period: m.period,
      periodSeconds: m.periodSeconds,
      tickCount: m.tickCount,
      prismaMatchId: m.prismaMatchId,
    })),
    log: simState.log.slice(-20),
  });
});

export { router as simRouter };
```

- [ ] **Step 2: Verify no syntax errors**

Run: `npx tsx -e "import('./src/lib/simulation/sim-routes.ts').then(() => console.log('OK')).catch(e => console.error(e.message))"`

---

## Track C: Integration & Admin (agent: `integrator`, depends on A + B)

### Task 8: Wire simulation into server.ts and champion-data.ts

**Files:**
- Modify: `server.ts`
- Modify: `src/lib/champion-data.ts`

- [ ] **Step 1: Add env var toggle to champion-data.ts**

In `src/lib/champion-data.ts`, replace the `BASE_URL` constant and modify `fetchFromChampionData`:

```typescript
const SIM_MODE = process.env.SIMULATION_MODE === 'true';
const SIM_BASE = `http://localhost:${process.env.PORT || 3000}/api/sim`;
const CD_BASE =
  process.env.CHAMPION_DATA_BASE_URL || 'https://mc.championdata.com/data';

async function fetchFromChampionData<T>(path: string, revalidate = 3600): Promise<T> {
  const baseUrl = SIM_MODE ? SIM_BASE : CD_BASE;
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, SIM_MODE ? {} : { next: { revalidate } });

  if (!res.ok) {
    throw new Error(`Champion Data API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
```

Note: When `SIM_MODE` is true, we skip the `next: { revalidate }` option since we're fetching from localhost and want fresh data every time.

- [ ] **Step 2: Mount sim routes in server.ts**

In `server.ts`, add the simulation routes conditionally:

After the `import { startWorker, stopWorker }` line, add:

```typescript
const SIM_MODE = process.env.SIMULATION_MODE === 'true';
```

After `expressApp.set("io", io);` and before the Next.js handler, add:

```typescript
  // Mount simulation routes (dev only)
  if (SIM_MODE) {
    import('./src/lib/simulation/sim-routes').then(({ simRouter }) => {
      expressApp.use('/api/sim', simRouter);
      console.log('[Server] Simulation routes mounted at /api/sim');
    });
  }
```

- [ ] **Step 3: Add SIMULATION_MODE to .env**

Add to `.env` (commented out by default):

```
# Set to "true" to enable live game simulation (dev only)
# SIMULATION_MODE=true
```

- [ ] **Step 4: Test the wiring manually**

Start the dev server with simulation mode:
```bash
SIMULATION_MODE=true npm run dev
```

Verify the sim routes respond:
```bash
curl http://localhost:3000/api/sim/status
```
Expected: `{"running":false,"paused":false,"speed":1,"matches":[],"log":[]}`

```bash
curl -X POST http://localhost:3000/api/sim/control -H 'Content-Type: application/json' -d '{"action":"start","matchCount":1}'
```
Expected: `{"ok":true,"matches":1}`

```bash
curl http://localhost:3000/api/sim/fixture.json
```
Expected: JSON with `fixture.match` array containing 1 match.

```bash
curl -X POST http://localhost:3000/api/sim/control -H 'Content-Type: application/json' -d '{"action":"stop"}'
```
Expected: `{"ok":true}`

---

### Task 9: Build the admin panel

**Files:**
- Create: `src/app/admin/sim/page.tsx`
- Create: `src/app/admin/sim/SimPanel.tsx`

- [ ] **Step 1: Create the server component page**

Create `src/app/admin/sim/page.tsx`:

```tsx
import { SimPanel } from './SimPanel';

export const metadata = {
  title: 'Simulation Control | CentrePass Admin',
};

export default function SimAdminPage() {
  if (process.env.SIMULATION_MODE !== 'true') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface">
        <div className="text-center p-8">
          <h1 className="text-2xl font-headline font-bold text-on-surface mb-2">
            Simulation Not Enabled
          </h1>
          <p className="text-on-surface-variant">
            Set <code className="bg-surface-variant px-2 py-1 rounded">SIMULATION_MODE=true</code> in your environment to enable the simulation panel.
          </p>
        </div>
      </div>
    );
  }

  return <SimPanel />;
}
```

- [ ] **Step 2: Create the client component with controls**

Create `src/app/admin/sim/SimPanel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

interface SimMatchStatus {
  matchIndex: number;
  state: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: number;
  periodSeconds: number;
  tickCount: number;
  prismaMatchId: string;
}

interface SimStatusResponse {
  running: boolean;
  paused: boolean;
  speed: number;
  matches: SimMatchStatus[];
  log: Array<{ timestamp: number; matchIndex: number; message: string }>;
}

const SPEEDS = [1, 2, 5, 10, 50];
const STATES = [
  'pre-match', 'q1-active', 'q1-break', 'q2-active', 'q2-break',
  'q3-active', 'q3-break', 'q4-active', 'match-complete',
];

async function simControl(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch('/api/sim/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  return res.json();
}

async function fetchStatus(): Promise<SimStatusResponse> {
  const res = await fetch('/api/sim/status');
  return res.json();
}

export function SimPanel() {
  const [status, setStatus] = useState<SimStatusResponse | null>(null);
  const [matchCount, setMatchCount] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchStatus();
      setStatus(s);
      setError(null);
    } catch {
      setError('Failed to fetch simulation status');
    }
  }, []);

  // Poll status every second when running
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleStart = async () => {
    await simControl('start', { matchCount });
    refresh();
  };

  const handleStop = async () => {
    await simControl('stop');
    refresh();
  };

  const handlePause = async () => {
    await simControl('pause');
    refresh();
  };

  const handleResume = async () => {
    await simControl('resume');
    refresh();
  };

  const handleStep = async () => {
    await simControl('step');
    refresh();
  };

  const handleSpeed = async (speed: number) => {
    await simControl('speed', { multiplier: speed });
    refresh();
  };

  const handleGoto = async (matchIndex: number, state: string) => {
    await simControl('goto', { matchIndex, state });
    refresh();
  };

  return (
    <div className="min-h-screen bg-surface p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-headline font-bold text-on-surface">
            Simulation Control
          </h1>
          <p className="text-on-surface-variant mt-1">
            Control the live game simulation for E2E testing
          </p>
        </div>

        {error && (
          <div className="bg-error-container text-on-error-container p-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Controls */}
        <div className="bg-surface-container rounded-xl p-4 space-y-4">
          <h2 className="text-lg font-headline font-semibold text-on-surface">
            Controls
          </h2>

          <div className="flex flex-wrap gap-3 items-center">
            {!status?.running ? (
              <div className="flex items-center gap-3">
                <label className="text-sm text-on-surface-variant">Matches:</label>
                <select
                  value={matchCount}
                  onChange={(e) => setMatchCount(Number(e.target.value))}
                  className="bg-surface-container-high text-on-surface rounded-lg px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button
                  onClick={handleStart}
                  className="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90"
                >
                  Start
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleStop}
                  className="bg-error text-on-error px-4 py-2 rounded-lg text-sm font-medium hover:bg-error/90"
                >
                  Stop
                </button>
                {status.paused ? (
                  <button
                    onClick={handleResume}
                    className="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    onClick={handlePause}
                    className="bg-secondary text-on-secondary px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Pause
                  </button>
                )}
                <button
                  onClick={handleStep}
                  className="bg-tertiary text-on-tertiary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Step
                </button>
              </>
            )}
          </div>

          {/* Speed control */}
          {status?.running && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-on-surface-variant">Speed:</span>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSpeed(s)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium ${
                    status.speed === s
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Match Cards */}
        {status?.matches && status.matches.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-headline font-semibold text-on-surface">
              Matches
            </h2>
            {status.matches.map((m) => (
              <div
                key={m.matchIndex}
                className="bg-surface-container rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-right min-w-[140px]">
                      <span className="font-semibold text-on-surface">
                        {m.homeTeam}
                      </span>
                    </div>
                    <div className="text-center">
                      <span className="text-2xl font-bold font-headline text-on-surface">
                        {m.homeScore} - {m.awayScore}
                      </span>
                    </div>
                    <div className="min-w-[140px]">
                      <span className="font-semibold text-on-surface">
                        {m.awayTeam}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                      {m.state}
                    </span>
                    {m.prismaMatchId && (
                      <a
                        href={`/match/${m.prismaMatchId}/live`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs bg-tertiary/10 text-tertiary px-2 py-1 rounded-full font-medium hover:bg-tertiary/20"
                      >
                        Open Live Page
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm text-on-surface-variant">
                  <span>Q{m.period}</span>
                  <span>{Math.floor(m.periodSeconds / 60)}:{String(m.periodSeconds % 60).padStart(2, '0')}</span>
                  <span>Tick #{m.tickCount}</span>
                </div>

                {/* Jump to state */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-on-surface-variant">Jump to:</span>
                  <select
                    value={m.state}
                    onChange={(e) => handleGoto(m.matchIndex, e.target.value)}
                    className="bg-surface-container-high text-on-surface rounded-lg px-2 py-1 text-xs"
                  >
                    {STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Log */}
        {status?.log && status.log.length > 0 && (
          <div className="bg-surface-container rounded-xl p-4">
            <h2 className="text-lg font-headline font-semibold text-on-surface mb-3">
              Event Log
            </h2>
            <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
              {[...status.log].reverse().map((entry, i) => (
                <div key={i} className="text-on-surface-variant">
                  <span className="text-on-surface/50">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>{' '}
                  {entry.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the page renders**

With `SIMULATION_MODE=true npm run dev` running, navigate to `http://localhost:3000/admin/sim`.

Expected: The admin panel loads with Start button and match count selector.

---

### Task 10: End-to-end integration test

**Files:** None created — manual verification.

- [ ] **Step 1: Start dev server in simulation mode**

```bash
SIMULATION_MODE=true CHAMPION_DATA_COMP_ID=99999 npm run dev
```

Note: `CHAMPION_DATA_COMP_ID` must be set for the worker to run. Setting it to `99999` is fine — the worker will fetch from the sim routes, not Champion Data.

- [ ] **Step 2: Start a simulation via the admin panel**

Navigate to `http://localhost:3000/admin/sim`.
Click "Start" with 2 matches selected.
Expected: Two match cards appear with "pre-match" state.

- [ ] **Step 3: Verify the live page works**

Click the "Open Live Page" link on one of the match cards.
Expected: The live page loads showing the match. Initially shows 0-0 with "Scheduled" status.

- [ ] **Step 4: Speed up and observe live updates**

Back on the admin panel, set speed to 10x.
Expected: Scores start changing on both the admin panel and the live page. Play-by-play entries appear. Quarter transitions happen visibly.

- [ ] **Step 5: Test pause/resume/step**

Click "Pause" — verify scores stop changing.
Click "Step" — verify scores advance by one tick only.
Click "Resume" — verify auto-play resumes.

- [ ] **Step 6: Test jump-to-state**

Use the "Jump to" dropdown to set a match to "match-complete".
Expected: Match shows final status. The live page shows the match as completed.

- [ ] **Step 7: Test stop and cleanup**

Click "Stop".
Expected: All matches disappear. The temporary Match records are deleted from the database. The live pages show 404 or redirect.

- [ ] **Step 8: Verify Socket.io events**

Open browser dev tools on the live page, check the Network tab for WebSocket frames.
Verify you see:
- `score:update` events with changing scores
- `stats:update` events with player stats (new — was previously missing)
- `scoreflow:add` events with individual goals (new — was previously missing)
- `match:status` events on state transitions

- [ ] **Step 9: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass.
