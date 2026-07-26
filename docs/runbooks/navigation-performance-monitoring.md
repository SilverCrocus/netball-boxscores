# Navigation performance monitoring

This runbook covers the read-only production browser monitor for the CentrePass
Live, Standings, Rankings, and Records navigation paths.

## Safety and scope

The monitor:

- checks `/api/health` and `/api/readiness` before opening a browser;
- can require the exact deployed release SHA;
- makes only public GET/navigation requests;
- runs one browser journey at a time;
- never signs in, changes data, clears production caches, or calls admin routes;
- records path groups only, never query strings, entity IDs, cookies, bodies,
  credentials, or user data;
- treats Next.js RSC `ERR_ABORTED` teardown events as diagnostic, not as product
  failures, while retaining their count; and
- records the existing Google Tag Manager CSP rejection as known diagnostic
  noise while continuing to fail on every other browser console or page error.

Do not increase concurrency or sample counts and describe the result as a load
test. The monitor is a controlled sequential synthetic check.

## What it measures

The primary matrix uses one excluded warmup and 20 measured samples:

| Profile | Interaction | Transitions |
| --- | --- | --- |
| Desktop 1440x900 | real pointer hover, completed intent opportunity, click | Records → Rankings → canonical Standings → Live → Records |
| Desktop 1440x900 | keyboard focus, completed intent opportunity, Enter | Records → Rankings and Live → Records |
| Mobile 390x844 | touch tap | Records → Rankings → canonical Standings → Live → Records |

The monitor discovers the canonical published Standings URL from the visible
Rankings navigation. `/live` may remain on the Live hub or redirect to a public
match while an event is live.

It also performs:

- a clean `/records` idle-prefetch request/byte observation;
- Save-Data and 2G policy checks that require zero Rankings/Records RSC
  prefetch before click; and
- browser console, page error, same-origin request failure, HTTP 5xx, health,
  readiness, and release-identity checks.

## Budgets

The checked-in initial budgets are:

- route-switch p95 at or below 2,000 ms;
- visible acknowledgement or completed navigation p95 at or below 150 ms;
- no browser runtime errors, unexpected same-origin request failures, or 5xx;
- zero target RSC requests after a completed pointer/keyboard intent prefetch;
- no more than eight idle RSC requests from a clean Records load; and
- no more than 20,000 completed idle RSC response-body bytes.

The byte budget includes limited headroom above the accepted navigation audit.
If Playwright cannot expose a transfer size, the byte result is `OBSERVE`, not
an invented zero or a failure.

Budget misses are report-only during the initial observation window. Endpoint,
release, browser, or evidence-generation failures still fail the workflow
because the monitor did not produce valid evidence. After 7–14 stable days,
enable `enforce_budgets` only after reviewing the distributions and recording
the decision.

## GitHub Actions

After this branch is merged to the default branch,
`.github/workflows/navigation-performance.yml` runs daily at 19:17 UTC and can
also be started manually. The schedule is not active from an unmerged feature
branch.

Manual inputs:

- `expected_release_sha`: optional exact production SHA; otherwise the checked
  out commit is required;
- `samples`: 1–50 measured samples per group, normally 20; and
- `enforce_budgets`: defaults to false.

Every run adds a Markdown summary and retains JSON/Markdown evidence for 30
days. Scheduled work is single-flight and never cancels an in-progress run.

## Local read-only run

Install the pinned Chromium runtime once:

```sh
npx playwright install chromium
```

Run a short diagnostic sample against the current production release:

```sh
npm run monitor:navigation -- \
  --expected-release "$(git ls-remote origin refs/heads/main | cut -f1)" \
  --samples 1 \
  --output /tmp/centrepass-navigation-performance
```

Use 20 samples for evidence. Do not set `--enforce-budgets` until the initial
observation window is formally closed.

## Evidence interpretation

Compare only runs with the same release, sample count, device matrix, cache
method, and sequential topology. A budget miss identifies where to investigate;
it does not authorize a database, cache, framework, or Rust rewrite.

Keep client navigation, pending acknowledgement, RSC traffic, and server
operation timing separate:

- slow navigation plus fast server timing points toward transfer/render work;
- slow server operations point toward route/data work;
- extra idle traffic points toward prefetch policy;
- post-click target RSC after completed intent points toward segment-cache or
  prefetch consumption; and
- low sample counts or a release mismatch invalidate the comparison.

Record baseline and enforcement decisions in
[`../performance.md`](../performance.md).
