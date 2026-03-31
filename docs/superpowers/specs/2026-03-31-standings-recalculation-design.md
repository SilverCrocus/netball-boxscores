# Standings Recalculation on Match Completion

## Problem

The `Standing` table is populated during database seeding but never updated when matches complete via the live tracking pipeline. This causes the standings page and team profile pages to show stale W-L records, points, and goal percentages.

**Example:** Thunderbirds should be 3-0 but the standings show 2-0, even though their recent form section (which reads directly from match records) correctly shows all 3 wins.

## Root Cause

`reconcileCompletedMatches()` in `match-sync.ts` transitions matches from LIVE → COMPLETED and updates scores, but does not recalculate the `Standing` table. The standings were only ever computed once during `prisma/seed.ts` Step 7.

## Goal

When any match transitions to COMPLETED status, automatically recalculate the full standings table from all completed match results in the database.

## Architecture

### New Function: `recalculateStandings()`

Location: `src/lib/standings.ts`

Logic:
1. Query all COMPLETED, non-sim matches from the DB
2. For each match, compute W/L/D and goals for each team
3. Apply SSN points system: 4 for win, 2 for draw, 0 for loss, +2 bonus for 16+ goal margin win
4. Compute goal percentage (goalsFor / goalsAgainst × 100)
5. Sort by points desc, then goal percentage desc
6. Upsert all Standing records with new computed values

### Integration Point

Called from `pollChampionData()` in `worker.ts` after `reconcileCompletedMatches()` returns completed matches (only when completedMatches.length > 0).

### Standalone Script

`scripts/recalculate-standings.ts` — calls the same function for one-time fixes.

## SSN Points System

- Win: 4 points
- Draw: 2 points
- Loss: 0 points
- Bonus: +2 points for winning by 16+ goals

## Data Flow

```
Match completes → reconcileCompletedMatches() → recalculateStandings()
                                                      ↓
                                              Query all COMPLETED matches
                                                      ↓
                                              Compute W/L/D, points, goals
                                                      ↓
                                              Upsert Standing records
```
