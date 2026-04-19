# Data Pipeline Refactor — Disciplined Pipeline with Audit Trail

**Date:** 2026-04-19  
**Status:** Design approved  
**Scope:** Worker, data ingestion, validation, live detection, client clock, broadcasting

## Problem Statement

The CentrePass data pipeline has reliability issues causing:
1. Live games not detected — 15-minute match-day polling interval misses SCHEDULED→LIVE transitions
2. Results not recording — matches stuck in wrong status (LIVE or SCHEDULED) after completion
3. Client-side clock ticking independently of server — displays fabricated times between polls
4. No audit trail — when data is wrong, no way to inspect what Champion Data actually sent
5. `nearLive` concept sends users to live pages before data is actually flowing

The existing architecture (CD → Worker → DB → SSR/Socket → Browser) is sound — there is a single pipeline, not multiple competing data sources. The problems are in polling intervals, lack of validation, and lack of observability.

## Architecture Overview

```
Champion Data API
       |
   [Phase 1: INGEST]
       | fetch fixture + match details
       | store raw JSON in PollLog table
       |
   [Phase 2: VALIDATE & PROCESS]
       | validate team/player ID mapping
       | validate score consistency
       | validate quarter/time sanity
       | if valid: transform → write to live tables
       | if invalid: log to PollLog, skip match
       |
  Live DB Tables (Match, PlayerMatchStats, ScoreFlow, MatchQuarter)
       |
   [Phase 3: BROADCAST]
       | read changes from live tables (e.g., score flow with scorer attribution)
       | emit socket events (delta-only for score flow)
       |
       ├── SSR page loads (initial data from DB)
       ├── Socket.io (live updates from broadcast)
       └── /api/live-status (nav polling from DB)
       |
   Browser
```

## 1. New Database Table: PollLog

Stores every Champion Data API response before processing. Audit trail for debugging.

```prisma
model PollLog {
  id            String   @id @default(cuid())
  polledAt      DateTime @default(now())
  competitionId Int
  cdMatchId     Int?     // null for fixture polls, set for match-detail polls
  endpoint      String   // "fixture" or "match-detail"
  rawResponse   Json     // full CD JSON response
  status        String   // "success" | "fetch_error" | "validation_error" | "processed"
  errorMessage  String?
  processingMs  Int?

  @@index([polledAt])
  @@index([cdMatchId, polledAt])
}
```

**Lifecycle:**
1. Worker fetches from CD → writes PollLog row with `status: "success"` and raw JSON
2. Fetch fails → writes `status: "fetch_error"` with error message
3. Validation fails → updates to `"validation_error"` with details
4. Processing succeeds → updates to `"processed"` with processing duration

**Retention:** The worker runs a cleanup at the start of each poll cycle (cheap `DELETE WHERE polledAt < now - 7 days` query). Keeps PollLog bounded without a separate cron job.

## 2. Worker Refactor: Three-Phase Pipeline

The current 545-line `worker.ts` monolith splits into focused modules:

### File structure:
- **`worker.ts`** (~100 lines) — orchestrator: poll loop, scheduling, startup/shutdown, health state
- **`ingestion.ts`** (~80 lines) — fetch from CD, store raw in PollLog, return raw data
- **`processing.ts`** (~200 lines) — validate, transform, write to live tables. Absorbs current `match-sync.ts`
- **`broadcasting.ts`** (~100 lines) — socket event emission with delta computation for score flow

### Phase 1: Ingest (`ingestion.ts`)

```typescript
interface IngestedData {
  fixture: CDFixtureMatch[];
  matchDetails: Map<number, CDMatchStatsResponse>; // keyed by CD match ID
  pollLogIds: string[]; // PollLog row IDs for status updates
}

async function ingestFromChampionData(competitionId: number): Promise<IngestedData>
```

- Fetches CD fixture endpoint → stores raw JSON in PollLog
- For each match that needs processing (playing or needs backfill): fetches match detail → stores raw JSON in PollLog
- Returns raw data objects for Phase 2
- Fetch errors are caught per-match and logged to PollLog — the cycle continues

### Phase 2: Validate & Process (`processing.ts`)

```typescript
interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  validatedData: ProcessedMatchState | null;
}

function validateMatchData(
  rawFixture: CDFixtureMatch,
  rawDetail: CDMatchStatsResponse,
  dbTeams: Map<number, TeamInfo>,
  dbPlayers: Map<number, PlayerInfo>,
): ValidationResult

async function processMatch(
  validatedData: ProcessedMatchState
): Promise<ChangeResult>
```

Validation checks:

| Check | Catches | Severity |
|-------|---------|----------|
| Team ID mapping — CD `squadId` maps to a `Team` in DB | Broken if CD adds/changes teams | Critical — skip match |
| Player ID mapping — CD `playerId` maps to a `Player` in DB | New players mid-season | Warning — skip unknown players |
| Score consistency — fixture totals match match-detail team stats | CD internal inconsistency | Warning — use fixture as source of truth |
| Quarter validity — `period` is 1–4 (or 5+ for extra time) | Corrupt data | Critical — skip match |
| Time validity — `periodSeconds` ≥ 0 and ≤ quarter length + buffer | Clock weirdness | Warning — clamp to valid range |
| Status sanity — CD `matchStatus` is recognized value | Unknown status | Warning — default to SCHEDULED |
| Score monotonicity — running score flow totals never decrease | Corrupt/reordered score flow | Critical — skip score flow for this poll |

Failure handling:
- **Critical failure:** Match data NOT written to live tables. PollLog updated to `"validation_error"`. Worker continues to next match.
- **Warning:** Match data IS written. Anomaly logged. PollLog status is `"processed"` with warnings noted.

### Phase 3: Broadcast (`broadcasting.ts`)

Socket events remain the same five types: `score:update`, `match:status`, `stats:update`, `scoreflow:add`, `stat:event`.

Key change: **Score flow is delta-only.** Worker tracks the last known score flow count per match. Only new entries are broadcast. The client's `useMatchSocket` already handles accumulation.

```typescript
// Worker maintains per-match state during the session
const matchScoreFlowCounts = new Map<string, number>();

async function broadcastScoreFlowDelta(matchId: string): Promise<void>
// Reads score flow from DB, compares count to last known, broadcasts only new entries
```

## 3. Single Live Detection: `getLiveState()`

Replaces five separate live-detection implementations with one function.

```typescript
// src/lib/live-state.ts

interface LiveState {
  liveMatchIds: string[];        // matches with status LIVE
  imminentMatchIds: string[];    // SCHEDULED within ±60min
  nextMatchAt: Date | null;      // nearest SCHEDULED within 1 hour
  isMatchDay: boolean;           // any match scheduled today (AEST)
}

async function getLiveState(): Promise<LiveState>
```

**Consumers:**
- **Worker** — determines polling interval from `liveMatchIds`, `imminentMatchIds`, `isMatchDay`
- **`/api/live-status`** — returns `{ hasLive, nextMatchAt }`. No more `nearLive`.
- **`/live` redirect** — redirects only when `liveMatchIds.length > 0`. Otherwise shows "No live matches" with countdown.

**The `nearLive` concept is removed.** The nav shows "Live" badge only when a match has `status: LIVE` in the DB. For imminent matches, the nav shows a "Starting in X min" countdown that is informational only (not a link to the live page).

## 4. Client-Side Changes

### 4a. Server-Driven Clock Only

**Delete `useLocalClock.ts` entirely.** The game clock displays exactly what the server sends via socket:

```typescript
// LiveGameClient.tsx — before:
const time = useLocalClock(isLive ? serverTime : null) ?? serverTime;

// After:
const time = socketScore?.currentTime ?? match.currentTime;
```

The clock updates in ~30s steps (matching the poll interval). Between updates it stays static. This is honest — it reflects what we actually know.

### 4b. Homepage Live Awareness

The homepage already renders match cards via SSR and already imports `useLiveStatus` in the Sidebar/BottomNav. To make the homepage reactive: the homepage component checks `useLiveStatus().hasLive` and, when true, triggers a client-side re-fetch of today's matches from a new lightweight API route (`/api/today-matches`) to get updated scores. This avoids adding a socket connection to the homepage while still reflecting live match state within 30 seconds.

### 4c. Simplified `useLiveStatus`

Remove the `nearLive` field from the hook's return type and the API route. The hook returns:

```typescript
interface LiveStatus {
  hasLive: boolean;
  minutesUntilNext: number | null;
}
```

Nav components use `hasLive` for the "Live" badge and `minutesUntilNext` for the countdown.

## 5. Polling Interval Overhaul

| Condition | Old Interval | New Interval | Rationale |
|-----------|-------------|-------------|-----------|
| Live match in DB | 30s | 30s | No change |
| Pre-match (SCHEDULED within window) | 60s (±30min) | 60s (±60min) | Wider window catches early/late starts |
| Match day | **15 min** | **2 min** | Critical fix — catches transitions within 2 minutes |
| Off-season | 6 hours | 1 hour | Faster schedule/fixture updates |
| Sim mode | 2s | 2s | No change |

The CD fixture endpoint returns ~56 matches as a few KB of JSON. 2-minute polling on match day = ~720 requests/day. Champion Data is a sports data provider — this is well within normal usage and eliminates the entire class of "missed the transition" bugs.

**Startup behavior:** Always poll immediately on startup. If Render restarts mid-match, the worker catches up within seconds.

## 6. Worker Health Endpoint

New route: `/api/worker-health`

```json
{
  "lastPollAt": "2026-04-19T10:30:00.000Z",
  "lastPollStatus": "processed",
  "currentIntervalMs": 30000,
  "matchesProcessed": 1,
  "pollsSinceStartup": 142,
  "uptimeMs": 3600000,
  "isHealthy": true
}
```

`isHealthy` is `false` if `lastPollAt` is more than 2x the current interval ago (worker missed a scheduled poll).

Worker stores health state in module-level variables — no DB writes. The endpoint reads these variables directly.

## 7. Existing Code Disposition

| Current file | What happens |
|-------------|-------------|
| `worker.ts` (545 lines) | Refactored → slim orchestrator (~100 lines) |
| `match-sync.ts` (297 lines) | Absorbed into `processing.ts` |
| `champion-data.ts` (274 lines) | Kept as-is — clean CD API client and transform layer |
| `socket-server.ts` (75 lines) | Kept as-is — broadcast functions stay here |
| `useLocalClock.ts` (44 lines) | **Deleted** |
| `useLiveStatus.ts` (49 lines) | Simplified — remove `nearLive` |
| `/api/live-status/route.ts` (49 lines) | Simplified — uses `getLiveState()`, no more `nearLive` |
| `/live/page.tsx` | Updated — redirect only on actual LIVE, show fallback otherwise |
| `LiveGameClient.tsx` | Remove `useLocalClock` usage, use server time directly |

## 8. Migration Strategy

This refactor does not change the database schema for existing tables — only adds the new `PollLog` table. No data migration needed. The refactor can be deployed as a single release:

1. Add `PollLog` model to schema, run `prisma db push`
2. Deploy new worker code (ingestion + processing + broadcasting split)
3. Deploy new `live-state.ts` and updated consumers
4. Deploy client-side changes (delete `useLocalClock`, simplify `useLiveStatus`)
5. Deploy worker health endpoint

The existing live tables continue to be the source of truth for the UI. The PollLog is additive — it doesn't change how data flows to the browser, only adds observability.

## 9. Out of Scope

- **Database schema changes to existing tables** — Match, PlayerMatchStats, ScoreFlow, MatchQuarter are fine as-is
- **Real-time push from CD** — CD is a polling API, not a push/webhook API
- **Player/team sync automation** — currently handled by seed script, stays manual
- **Simulation system changes** — sim pipeline remains separate, only exercises the existing worker path
- **Turbopack dev error** — separate issue, not part of this refactor
