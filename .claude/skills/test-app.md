---
name: test-app
description: Test the CentrePass app with Playwright - verify live scores, match completion, and page health in a dev → test → evaluate → improve loop
---

# Test CentrePass App

Use Playwright MCP tools to test the running app visually. This skill supports iterative development: make changes → test → evaluate → improve.

## Prerequisites

The dev server must be running on `http://localhost:3000`. If not running, start it:

```bash
npm run dev > /tmp/netball-dev.log 2>&1 &
```

Then wait for it:
```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200"; do sleep 1; done
```

## Test Procedure

### 1. Homepage Health Check

Navigate to `http://localhost:3000` and verify:
- Page loads without errors (check console)
- Live match card appears with green LIVE badge and updating timer (if match day)
- Completed matches show "Final" badge with scores (no stuck timers)
- Upcoming fixtures show date/time, not scores

Take a full-page screenshot for visual inspection.

### 2. Live Match Page (if live match exists)

Navigate to `http://localhost:3000/live` (redirects to active match). Verify:
- Score hero shows quarter badge (e.g., "Q1 • 2:22") with green dot
- Both team names, badges, and scores visible
- Quarter score grid populates as quarters complete
- Score progression chart renders with two team-colored lines
- Live Lineups table shows on-court players with stats
- Live Feed shows recent scoring events with timestamps

**Critical check for the completion bug:** If the timer shows < 2:00 remaining in Q4, watch for:
- Timer should NOT freeze (take two screenshots 30s apart, timer should change OR show "Full Time")
- If `match:status` socket event arrives with COMPLETED, timer must disappear and "Full Time" badge must appear

### 3. Completed Match Page

Navigate to a completed match (find from homepage results section). Verify:
- Shows "FINAL" label above scores (not a timer)
- No green LIVE badge or quarter timer visible
- Score progression chart shows full game (Q1-Q4)
- Box score tables have player stats
- Match MVP card displayed

### 4. Match Transition (if testable)

If a match is near completion (Q4 with low remaining time):
1. Take screenshot showing current state
2. Wait 60-90 seconds
3. Take another screenshot
4. Compare: either timer progressed OR match shows "Full Time"
5. If timer is frozen at same value for 60s+ → BUG (report it)

### 5. API Health Checks

Use `browser_evaluate` to fetch and verify:
- `GET /api/live-status` returns `{ hasLive: boolean, nextMatchAt: string|null }`
- `GET /api/worker-health` returns worker polling status (interval, lastPoll, status)

## Evaluation Criteria

After testing, report:

| Check | Status | Notes |
|-------|--------|-------|
| Homepage loads | PASS/FAIL | |
| Live badge visible (if live) | PASS/FAIL/N/A | |
| Timer updating (not frozen) | PASS/FAIL/N/A | |
| Completed match shows Final | PASS/FAIL | |
| No console errors on pages | PASS/FAIL | List errors if any |
| Worker health OK | PASS/FAIL | |

## Common Issues to Watch For

- **Stuck timer at low value** → Match completion not broadcasting `time: '0'`
- **LIVE badge on completed match** → Status transition missed by client
- **Missing scores in quarter grid** → MatchQuarter records not written
- **Empty live feed** → Score flow delta tracking reset issue
- **Console: socket disconnect errors** → Server/client socket lifecycle issue
- **"hydration mismatch" errors** → Server/client timezone divergence

## After Testing

Report findings to the user with:
1. Summary table (pass/fail)
2. Screenshots of any issues
3. Suggested fixes if bugs found

This enables the loop: the user makes changes → invokes `/test-app` → gets a report → iterates.
