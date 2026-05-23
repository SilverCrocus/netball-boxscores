---
name: test-app
description: Test the CentrePass app with Playwright - verify live scores, match completion, mobile responsiveness, and page health in a dev → test → evaluate → improve loop
---

# Test CentrePass App

Use Playwright MCP tools to test the running app visually at both desktop and mobile viewports. This skill supports iterative development: make changes → test → evaluate → improve.

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

### 1. Desktop Tests (1280x800)

Set viewport: `browser_resize` to 1280x800.

#### Homepage Health Check
Navigate to `http://localhost:3000` and verify:
- Page loads without console errors
- Live match card shows green LIVE badge and updating timer (if match day)
- Completed matches show "Final" badge with scores (no stuck timers)
- Upcoming fixtures show date/time, not scores

#### Live Match Page (if live match exists)
Navigate to `http://localhost:3000/live` (redirects to active match). Verify:
- Score hero shows quarter badge (e.g., "Q1 • 2:22") with green dot
- Both team names, badges, and scores visible
- Live Lineups shows **two teams side-by-side** in `grid-cols-2`
- No team toggle visible on desktop (toggle is `md:hidden`)
- Score progression chart renders
- Live Feed shows recent events

#### Completed Match Page
Navigate to a completed match from homepage results. Verify:
- Shows "FULL TIME" or "FINAL" label (not a timer)
- No green LIVE badge visible
- Live Lineups shows both teams side-by-side (desktop)

### 2. Mobile Tests (390x844)

Set viewport: `browser_resize` to 390x844.

#### Homepage Mobile
Navigate to `http://localhost:3000`. Verify:
- Bottom nav visible (not sidebar)
- Match cards stack vertically, readable
- No horizontal overflow

#### Live/Completed Match Page Mobile
Navigate to match page. Verify:
- Score hero stacks team names vertically
- **Team toggle pill bar appears** below "Live Lineups" heading
- Toggle shows team abbreviations (e.g., "MAV" / "LIG")
- Home team selected by default (highlighted pill)
- Only ONE team's stats table visible (full width, not squished)
- All stat columns (G, ATT, AST, INT, FD) readable

#### Toggle Interaction
- Click the away team pill button
- Verify: away team name appears as table header
- Verify: home team table is hidden
- Verify: away pill is now highlighted, home pill is not

#### Completed Match Box Score Mobile
Navigate to a completed match (non-live URL like `/match/{id}`). Verify:
- Player stats tables stack vertically (one per team, full width)
- No squished side-by-side layout

### 3. API Health Checks

Use `browser_evaluate` to fetch:
- `GET /api/live-status` → `{ hasLive: boolean, nextMatchAt: string|null }`
- `GET /api/worker-health` → polling status

### 4. Match Completion Verification

If a match recently completed or is near completion:
- The score hero should show "Full Time" or "FULL TIME" badge
- Timer badge (e.g., "Q4 • 0:30") should NOT be visible
- If timer IS visible with < 2:00 remaining and not changing → BUG

## Evaluation Criteria

After testing, report:

| Check | Status | Notes |
|-------|--------|-------|
| Homepage loads | PASS/FAIL | |
| Desktop: side-by-side lineups | PASS/FAIL | |
| Desktop: no team toggle visible | PASS/FAIL | |
| Mobile: team toggle visible | PASS/FAIL | |
| Mobile: toggle switches teams | PASS/FAIL | |
| Mobile: full-width stats table | PASS/FAIL | |
| Completed match shows Final | PASS/FAIL | |
| No stuck timer on completion | PASS/FAIL | |
| No console errors | PASS/FAIL | List errors if any |
| Worker health OK | PASS/FAIL/N/A | |

## Common Issues to Watch For

- **Stuck timer at low value** → Match completion not broadcasting `time: '0'`
- **LIVE badge on completed match** → Status transition missed by client
- **Squished tables on mobile** → Team toggle not rendering (check `md:hidden` class)
- **Toggle doesn't switch** → State not wired to conditional render
- **Both teams visible on mobile** → Desktop grid `hidden md:grid` not working
- **Toggle visible on desktop** → `md:hidden` class missing from toggle wrapper
- **Console: "hydration mismatch"** → Server/client rendering divergence (often timezone)
- **Empty live feed** → Score flow delta tracking reset issue

## After Testing

Report findings to the user with:
1. Summary table (pass/fail)
2. Screenshots of any issues (use descriptive filenames)
3. Suggested fixes if bugs found

Clean up screenshot files when done: `rm -f *.png`

This enables the loop: the user makes changes → invokes `/test-app` → gets a report → iterates.
