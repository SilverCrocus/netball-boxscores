# Standings Recalculation — Implementation Plan

## Batch 1: Core Recalculation Function

### Task 1.1: Create `src/lib/standings.ts`

**Requirements:**
- Export `recalculateStandings()` async function
- Query all COMPLETED matches where `round !== 99` (use `excludeSimData` from `@/lib/db`)
- For each match, determine winner/loser/draw and accumulate:
  - played, wins, losses, draws, goalsFor, goalsAgainst
- Apply SSN points: 4 win, 2 draw, 0 loss, +2 bonus for 16+ goal margin wins
- Compute goalPercentage = (goalsFor / goalsAgainst) × 100 (0 if no goals against)
- Sort teams by points desc, then goal percentage desc
- Upsert Standing records (use competitionId + teamId unique constraint)
- Must handle case where competition doesn't exist yet (early startup)
- Log the recalculation for debugging (`console.log` with timestamp)

### Task 1.2: Integrate into worker.ts

**Requirements:**
- Import `recalculateStandings` from `@/lib/standings`
- Call `recalculateStandings()` after `reconcileCompletedMatches()` when `completedMatches.length > 0`
- Wrap in try/catch so standings failure doesn't break the poll loop
- Log when standings recalculation is triggered

### Task 1.3: Create standalone script `scripts/recalculate-standings.ts`

**Requirements:**
- Import and call `recalculateStandings()` from `@/lib/standings`
- Print summary of results (team name, W-L-D, points)
- Runnable via `npx tsx scripts/recalculate-standings.ts`

## Batch 2: Tests

### Task 2.1: Unit test for `recalculateStandings()`

**Requirements:**
- Test with mock Prisma data: 2+ teams with completed matches
- Verify correct W/L/D counts
- Verify SSN points calculation (including 16+ bonus)
- Verify goal percentage calculation
- Verify ranking order (points first, then goal %)
- Verify sim data (round 99) is excluded
- Mock must include `excludeSimData: {}` per project conventions
