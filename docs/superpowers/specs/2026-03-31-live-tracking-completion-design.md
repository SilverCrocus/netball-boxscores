# Live Tracking Completion — Design Spec

## Problem

When a live match finishes, the system fails to detect game completion. Three cascading bugs result:

1. **Worker skips completed matches:** `worker.ts` filters fixture data to only process matches with `matchStatus === 'playing'`. When Champion Data reports a match as `complete`, the worker skips it — the DB status is never updated from `LIVE` to `COMPLETED`.

2. **No "Full Time" UI indicator:** `LiveScoreHero` only renders a live pulse badge. When the match ends, the live page has no visual state change — no "Full Time" badge, no indication the game is over.

3. **Homepage shows stale live matches:** `page.tsx` filters by `status === 'LIVE'`. Since the worker never updates the DB, completed games stay in the "LIVE ACTION" section indefinitely.

## Goal

When a match finishes:
- The worker detects the `playing → complete` transition in Champion Data and updates the DB status to `COMPLETED`
- A `match:status` COMPLETED event is broadcast via Socket.io
- The live page transitions to show a "Full Time" badge with the final score
- The homepage continues showing the match (per user preference: keep until next page load, then it moves to Results)
- The client disconnects the socket after receiving the completion event

## Architecture

No new services or infrastructure. All changes are within the existing worker → match-sync → Socket.io → client pipeline.

### Worker Changes

The `pollChampionData()` function currently skips all non-"playing" matches. The fix: after processing live matches, query the DB for any matches still marked `LIVE`, cross-reference against the fixture data, and if Champion Data says they're "complete", update the DB status and broadcast the completion.

This is a "reconciliation pass" — it catches the transition regardless of polling timing.

### UI Changes

**LiveScoreHero:** Add a "FULL TIME" badge that replaces the live pulse when `matchStatus?.status === 'COMPLETED'`. Styled as a static badge (no animation), using the design system's surface-container colors.

**LiveGameClient:** When `matchStatus` changes to `COMPLETED`, update `isLive` to false. The component already passes `isLive` and `matchStatus` to LiveScoreHero — no structural change needed.

**useMatchSocket:** On receiving `match:status` with `COMPLETED`, disconnect the socket after a short delay (2s, to allow final score/stats updates to arrive). No more reconnection.

### Homepage Behavior

No code change needed. The homepage is server-rendered (`force-dynamic`). Once the DB status is updated to COMPLETED, the next page load will correctly move the match from "LIVE ACTION" to "RESULTS". This matches the user's preference of "keep until next page load."

## Components Modified

| File | Change |
|------|--------|
| `src/lib/worker.ts` | Add reconciliation pass for LIVE→COMPLETED transitions |
| `src/lib/match-sync.ts` | Add `reconcileCompletedMatches()` function |
| `src/components/match/LiveScoreHero.tsx` | Add "Full Time" badge state |
| `src/app/match/[matchId]/live/LiveGameClient.tsx` | Handle COMPLETED status transition |
| `src/hooks/useMatchSocket.ts` | Disconnect socket on match completion |

## Design Decisions

- **"Full Time" not "Final":** Consistent with netball/Commonwealth broadcast conventions
- **Keep on homepage until page load:** Simpler than a timer-based approach, and matches user expectation
- **2s disconnect delay:** Allows final stats update to arrive before socket closes
- **Reconciliation pass, not filter change:** More robust than changing the filter to include "complete" matches — avoids re-processing all completed matches every poll cycle
