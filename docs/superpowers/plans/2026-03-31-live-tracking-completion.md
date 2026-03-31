# Live Tracking Completion — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-03-31-live-tracking-completion-design.md`
**Branch:** `bugfix/live-tracking-completion`

---

## Batch 1: Worker — Detect Game Completion

### Task 1.1: Add reconciliation function to match-sync.ts

Add a `reconcileCompletedMatches()` function to `src/lib/match-sync.ts` that:

1. Queries the DB for all matches with `status === 'LIVE'`
2. Accepts the fixture data (array of CDFixtureMatch) from the worker
3. For each LIVE match in DB, checks the fixture data for a matching `championDataMatchId`
4. If the fixture match has `matchStatus === 'complete'`, updates the DB match status to `COMPLETED`
5. Returns an array of match IDs that transitioned to COMPLETED (for broadcasting)

**Requirements:**
- Function signature: `reconcileCompletedMatches(fixtureMatches: CDFixtureMatch[]): Promise<Array<{ matchId: string; homeScore: number; awayScore: number }>>`
- Only updates matches that are currently `LIVE` in the DB but `complete` in Champion Data
- Updates `homeScore` and `awayScore` from the fixture data (final scores)
- Updates `status` to `COMPLETED`

### Task 1.2: Call reconciliation from worker.ts

Modify `pollChampionData()` in `src/lib/worker.ts` to:

1. After the existing `for` loop that processes "playing" matches, call `reconcileCompletedMatches(matches)` with the full fixture array
2. For each match returned, broadcast a `match:status` COMPLETED event via `broadcastMatchStatus()`
3. Also broadcast a final `score:update` with the final scores

**Requirements:**
- The reconciliation runs AFTER the live match processing loop, not inside it
- Both `match:status` and `score:update` events are broadcast for each newly completed match
- Import `reconcileCompletedMatches` from match-sync and `CDFixtureMatch` type

---

## Batch 2: Client — Socket Disconnect on Completion

### Task 2.1: Disconnect socket after match completion

Modify `src/hooks/useMatchSocket.ts` to:

1. When a `match:status` event with `status === 'COMPLETED'` is received, set a flag
2. After a 2-second delay, disconnect the socket and disable reconnection
3. The hook should still return the COMPLETED status in state (so the UI can react)

**Requirements:**
- Socket disconnect happens 2 seconds after receiving COMPLETED status
- The state still reflects `matchStatus: { status: 'COMPLETED', ... }` after disconnect
- `isConnected` becomes `false` after disconnect
- No reconnection attempts after intentional disconnect

---

## Batch 3: UI — Full Time Badge and State Transition

### Task 3.1: Add "Full Time" badge to LiveScoreHero

Modify `src/components/match/LiveScoreHero.tsx` to:

1. When `matchStatus?.status === 'COMPLETED'` OR `!isLive && dbHomeScore > 0` (match was already completed on page load), show a "FULL TIME" badge instead of the live pulse
2. Badge style: static (no animation), `bg-surface-container-high text-on-surface-variant`, same pill shape as the live badge
3. No quarter/time display in the Full Time badge — just "FULL TIME"

**Requirements:**
- "FULL TIME" badge replaces the live pulse indicator when match is completed
- Badge uses surface-container-high background, not secondary (no green — green = live)
- Quarter-by-quarter grid still displays (shows all quarter scores)
- If the page is loaded after the match ended (no socket data), the badge still shows based on DB status

### Task 3.2: Handle status transition in LiveGameClient

Modify `src/app/match/[matchId]/live/LiveGameClient.tsx` to:

1. Update the `isLive` derivation to check for COMPLETED status from socket
2. When `matchStatus?.status === 'COMPLETED'`, set `isLive = false`
3. The component already passes `matchStatus` to LiveScoreHero — no additional prop needed

**Requirements:**
- `isLive` becomes `false` when match:status COMPLETED is received
- The transition is immediate (no delay)
- All stats/scores remain visible — only the live indicator changes

### Task 3.3: Handle completed state on live page load

Modify `src/app/match/[matchId]/live/page.tsx` to:

1. If the match status is already `COMPLETED` when the page loads (SSR), still render the LiveGameClient but with the completed state
2. Do NOT redirect away — the user should see the final state of the live page with "Full Time"

**Requirements:**
- A completed match on `/match/[id]/live` shows the LiveScoreHero with "FULL TIME" badge
- Page does not redirect or show an error for completed matches
- All final stats and quarter scores are visible

---

## Batch 4: Tests

### Task 4.1: Test worker reconciliation logic

Add/update tests in `src/__tests__/lib/worker.test.ts` and `src/__tests__/lib/match-sync.test.ts`:

1. Test that `reconcileCompletedMatches` updates LIVE matches to COMPLETED when CD says complete
2. Test that it does NOT touch SCHEDULED or already-COMPLETED matches
3. Test that the worker calls reconciliation after the live processing loop

**Requirements:**
- At least 2 test cases for reconcileCompletedMatches (happy path + no-op)
- Mock prisma to verify DB queries and updates
- Test passes and doesn't break existing tests

### Task 4.2: Test Full Time UI rendering

Add/update tests for LiveScoreHero and LiveIndicator:

1. Test that LiveScoreHero renders "FULL TIME" when matchStatus is COMPLETED
2. Test that LiveScoreHero renders live pulse when matchStatus is LIVE
3. Test that the transition from LIVE to COMPLETED works

**Requirements:**
- At least 2 test cases for LiveScoreHero badge states
- Tests use React Testing Library
