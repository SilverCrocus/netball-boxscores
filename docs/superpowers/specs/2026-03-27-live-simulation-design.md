# Live Game Simulation System

**Date:** 2026-03-27
**Goal:** Full E2E pipeline testing of the live scores page without requiring a real Champion Data live match.

## Problem

The live pipeline (Champion Data polling -> match-sync -> Prisma -> Socket.io -> UI) can only be tested when a real SSN match is in progress. There is no way to simulate live data locally. Additionally, two Socket.io events (`stats:update`, `scoreflow:add`) are fully typed and listened for on the client but never emitted by the worker, and ScoreFlow data is never persisted despite the Prisma model existing.

## Approach

**Mock API Server** — A local simulation engine serves Champion Data-formatted JSON responses. The existing worker polls this instead of the real API via an env var toggle. The full production pipeline runs unchanged — the worker doesn't know it's simulated. An admin panel at `/admin/sim` provides visual controls.

```
Simulation Engine (state machine + data generator)
    ↓ serves CD-format JSON via Express routes
Worker (unchanged polling logic)
    ↓ detectChanges / applyChanges
Prisma DB
    ↓ broadcasts via Socket.io
useMatchSocket hook → Live page UI
```

**Key constraint:** Dev-only. Simulation routes, admin page, and all sim code are excluded from production builds.

## Architecture

### Env Var Toggle

- `SIMULATION_MODE=true` in `.env` (dev only)
- `champion-data.ts` reads this: when true, `fetchFixture()` and `fetchMatchStats()` hit local Express routes (`/api/sim/fixture.json`, `/api/sim/{matchId}.json`) instead of `mc.championdata.com`
- No changes to the worker, match-sync, socket-server, or UI code — the simulation is transparent to the rest of the pipeline

### Express Routes (dev-only)

Mounted on the existing Express server in `server.ts` when `SIMULATION_MODE=true`:

| Route | Purpose |
|-------|---------|
| `GET /api/sim/fixture.json` | Returns `CDFixtureResponse` with current simulation state |
| `GET /api/sim/:matchId.json` | Returns `CDMatchStatsResponse` for a simulated match |
| `POST /api/sim/control` | Admin control endpoint (start, stop, pause, resume, step, goto, speed) |
| `GET /api/sim/status` | Returns current simulation state for the admin panel |

### Worker Override

When `SIMULATION_MODE=true`, the worker polls at a fixed **2-second interval** regardless of the normal adaptive logic. This ensures UI updates feel responsive during simulation without modifying the worker's core logic — the interval override is applied in `getPollingInterval()`.

## Match State Machine

Each simulated match progresses through these states:

```
pre-match → q1-active → q1-break → q2-active → q2-break
    → q3-active → q3-break → q4-active → match-complete
```

### State Definitions

| State | `matchStatus` | `period` | `periodSeconds` | Scoring |
|-------|---------------|----------|-----------------|---------|
| `pre-match` | `"scheduled"` | 0 | 0 | None |
| `q1-active` | `"playing"` | 1 | 0→900 | Active |
| `q1-break` | `"playing"` | 1 | 900 | Frozen |
| `q2-active` | `"playing"` | 2 | 0→900 | Active |
| `q2-break` | `"playing"` | 2 | 900 | Frozen |
| `q3-active` | `"playing"` | 3 | 0→900 | Active |
| `q3-break` | `"playing"` | 3 | 900 | Frozen |
| `q4-active` | `"playing"` | 4 | 0→900 | Active (super shots possible) |
| `match-complete` | `"complete"` | 4 | 900 | None |

### Timing

- Each quarter: 900 game-seconds (15 minutes)
- Each tick advances `periodSeconds` by a configurable step (default: 30 game-seconds)
- At 1x speed: one tick every 30 real seconds (matches production poll interval)
- Speed multipliers compress the tick interval:
  - 2x = 15s between ticks
  - 5x = 6s between ticks
  - 10x = 3s between ticks
  - 50x = 0.6s between ticks (a full quarter in ~18 seconds)
- Quarter breaks: auto-advance after 2 ticks
- At `periodSeconds >= 900`, auto-transition to next state (break or complete)

### Score Progression

Based on real SSN averages (55-65 goals per team per match, ~14-16 per quarter):

- Each tick during active play: 0-2 goals per team (probabilistic)
  - ~50% chance of 0 goals, ~40% chance of 1, ~10% chance of 2
- Goals weighted by position: shooters score, others assist
- Q4 super shots (2 points) have ~15% probability when a goal is scored
- Score flow entries created for each goal with correct `periodSeconds`

### Multi-Match Support

- Simulate 1-4 matches simultaneously (configurable at start)
- Each match has an independent state machine
- Matches can start with staggered offsets (e.g. 0, 5, 10 ticks apart)
- Teams randomly paired from the database at simulation start

## Data Generation

### Fixture Response (`CDFixtureResponse`)

Uses real team data from the database:
- Squad IDs, names, codes from the `Team` table
- Venue names from existing matches
- `localStartTime` / `utcStartTime` set to simulation start time
- All other `CDFixtureMatch` fields populated to match real API shape

### Match Stats Response (`CDMatchStatsResponse`)

**`matchInfo`:** Current scores, period, periodSeconds — mirrors the state machine.

**`scoreFlow`:** Array of `CDScoreFlowEntry` — one entry per goal scored. Builds up as the match progresses. Each entry has:
- `period`, `periodSeconds`: When the goal was scored
- `squadId`: Which team scored
- `scorepoints`: 1 (normal) or 2 (super shot in Q4)
- `homeScore`, `awayScore`: Running total after this goal

**`periodScores`:** One `CDPeriodScore` per completed or active quarter. Updated each tick.

**`playerStats`:** 14 players per team (7 per side on court). Stats accumulate position-appropriately:

| Position | Primary Stats | Secondary Stats |
|----------|--------------|-----------------|
| GS, GA | goals, attempts (70-85% accuracy) | feeds, turnovers |
| GD, GK | intercepts, deflections, rebounds | penalties, turnovers |
| C | feeds, centre pass receives, goal assists | turnovers, deflections |
| WA | feeds, goal assists | centre pass receives, turnovers |
| WD | deflections, intercepts | feeds, turnovers |

Player lists pulled from the database for each team — they already have positions and real names.

**`teamStats`:** Aggregated from player stats.

## Admin Panel

### Page: `/admin/sim` (Next.js page, dev-only)

Layout:
- **Top bar:** Start/Stop, Pause/Resume, Speed slider (1x/2x/5x/10x/50x), Step Forward button
- **Match cards:** One card per simulated match showing:
  - Team names and current scores
  - Current state badge (e.g. "Q2 Active")
  - Period seconds / quarter time remaining
  - Tick count
  - Jump-to-state dropdown
- **Log panel:** Rolling log of recent simulation events (goals scored, state transitions)

### Control API (`POST /api/sim/control`)

Request body `{ action, ...params }`:

| Action | Params | Effect |
|--------|--------|--------|
| `start` | `{ matchCount?: number, teams?: string[] }` | Initialize and start simulation |
| `stop` | — | Stop simulation, reset all state |
| `pause` | — | Freeze all match state machines |
| `resume` | — | Resume from paused state |
| `step` | — | Advance all matches by one tick (when paused) |
| `goto` | `{ matchIndex: number, state: string }` | Jump a specific match to a state |
| `speed` | `{ multiplier: number }` | Change tick speed |

### Status API (`GET /api/sim/status`)

Returns:
```typescript
{
  running: boolean;
  paused: boolean;
  speed: number;
  matches: Array<{
    matchIndex: number;
    state: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    period: number;
    periodSeconds: number;
    tickCount: number;
  }>;
}
```

## Pipeline Fixes

These fixes apply to the real production pipeline — not just the simulation.

### 1. Broadcast `stats:update`

In `worker.ts`, after `applyChanges()` successfully persists player stats:
- Map the Champion Data player stats to `StatsUpdatePayload` format
- Resolve CD player IDs to Prisma player IDs (already done in `applyChanges`)
- Call new `broadcastStatsUpdate(matchId, payload)` on `socket-server.ts`
- Client already listens via `useMatchSocket` — no client changes needed

### 2. Broadcast `scoreflow:add`

In `worker.ts`, after detecting new score flow entries:
- Compare incoming `scoreFlow` array against previously seen entries (track by period + periodSeconds)
- For each new entry, emit `scoreflow:add` via new `broadcastScoreFlowAdd(matchId, payload)` on `socket-server.ts`
- Client already listens via `useMatchSocket` — no client changes needed

### 3. Persist ScoreFlow

In `match-sync.ts` `applyChanges()`:
- Upsert `ScoreFlow` records from the incoming `CDScoreFlowEntry[]` data
- Key by `[matchId, period, periodSeconds]` or similar unique combination
- The `ScoreFlow` Prisma model already exists with the right fields

## Database Setup

The worker's `detectChanges()` looks up matches by `championDataMatchId`. If simulated match IDs don't exist in the DB, the pipeline silently skips them (returns empty `matchId`). The simulation must create DB records that the pipeline can find.

### On `start`:
1. Query the DB for teams with `championDataTeamId` (needed for the fixture response)
2. Query players with `championDataPlayerId` per team (needed for player stats)
3. Create temporary `Match` records with:
   - Fake `championDataMatchId` values (e.g. 99001, 99002, ...) that won't collide with real CD IDs
   - Real `homeTeamId` / `awayTeamId` from the paired teams
   - `status: SCHEDULED`, scores at 0
   - `scheduledAt` set to now (so `checkIsMatchDay()` returns true)
4. Store the created match IDs in memory for cleanup

### On `stop`:
1. Delete the temporary `Match` records and their associated `MatchQuarter`, `PlayerMatchStats`, and `ScoreFlow` records (cascade)
2. Clear in-memory simulation state

### Data generation uses real IDs:
- Fixture response uses real `championDataTeamId` values as `homeSquadId`/`awaySquadId`
- Match stats response uses real `championDataPlayerId` values in `playerStats`
- This ensures the worker's existing ID resolution logic works unchanged

## Dev-Only Enforcement

- Sim routes in `server.ts` only mount when `SIMULATION_MODE=true`
- Admin page at `/admin/sim` checks `process.env.SIMULATION_MODE` server-side; renders "Simulation not enabled" when unset
- In production, `SIMULATION_MODE` is never set on Render — routes don't exist, page is inert

## File Structure

```
src/
  lib/
    simulation/
      engine.ts          # State machine, tick logic, score generation
      data-generator.ts  # CDFixtureResponse/CDMatchStatsResponse builders
      sim-routes.ts      # Express routes for /api/sim/*
      types.ts           # SimState, SimMatch, SimConfig types
  app/
    admin/
      sim/
        page.tsx         # Admin panel (server component shell)
        SimPanel.tsx     # Client component with controls + state display
```

## Scope Boundaries

**In scope:**
- Simulation engine with state machine and data generation
- Admin panel with visual controls
- Env var toggle in `champion-data.ts`
- Worker polling interval override for simulation mode
- Fix `stats:update` and `scoreflow:add` broadcasts
- Fix ScoreFlow persistence in `applyChanges()`

**Out of scope:**
- Recording real Champion Data responses for replay (future enhancement)
- Deploying simulation to Render/production
- MSW or client-side Socket.io mocking
- Automated E2E test suite using the simulation
- Changes to any UI components (they should work as-is)

## Testing Strategy

- Unit tests for the simulation engine (state transitions, score generation ranges)
- Unit tests for data generators (output matches CD type shapes)
- Manual E2E testing: start sim → watch live page update in real time → use admin controls to manipulate match state → verify all Socket.io events fire correctly
