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
- records Next.js RSC `ERR_ABORTED` teardown events separately, accepts them as
  accounted idle settlements, and still requires all intent and idle requests
  to reach a valid terminal outcome;
  and
- records the existing Google Tag Manager CSP rejection as known diagnostic
  noise while continuing to fail on every other browser console or page error.

Do not increase concurrency or sample counts and describe the result as a load
test. The monitor is a controlled sequential synthetic check.

## What it measures

The primary matrix uses one excluded warmup and 20 measured samples:

| Profile | Interaction | Transitions |
| --- | --- | --- |
| Desktop 1440x900 | real pointer hover; every sample emits and settles intent traffic; the group completes and sizes at least one target response; click | Records → Rankings → canonical Standings → Live → Records |
| Desktop 1440x900 | keyboard focus; every sample emits and settles intent traffic; the group completes and sizes at least one target response; Enter | Records → Rankings and Live → Records |
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

Route timing stops when both the logical destination URL and a new meaningful
visible main heading are ready. A separate 250 ms post-ready observation
window captures late hydration and network errors without inflating route or
acknowledgement timing.

## Budgets

The checked-in initial budgets are:

- route-switch p95 at or below 2,000 ms;
- visible acknowledgement or completed navigation p95 at or below 150 ms;
- no browser runtime errors, unexpected same-origin request failures, or 5xx;
- zero target RSC requests after a valid settled pointer/keyboard intent group;
- no more than eight idle RSC requests from a clean Records load; and
- no more than 20,000 completed idle RSC response-body bytes.

The byte budget includes limited headroom above the accepted navigation audit.
An idle request may either complete successfully or end in a known benign
`ERR_ABORTED` teardown. Bytes are counted only for completed responses; partial
transfer before an abort is not measured, so an all-benign-abort observation
legitimately records zero completed response-body bytes. Unsettled requests,
unexpected failures, or unsized completed responses invalidate the evidence and
fail the run. If byte sizes are unavailable after otherwise complete evidence,
the byte result is `OBSERVE`, not an invented zero. HTTP 5xx remains a separate
network gate.

Route, acknowledgement, idle-request-count, and idle-byte budget misses are
report-only during the initial observation window. Endpoint, release, browser,
runtime, network, policy-contract, sample-count, or evidence-validity failures
still fail the workflow because the monitor did not produce trustworthy
evidence. After 7–14 stable days, enable `enforce_budgets` only after reviewing
the distributions and recording the decision.

## GitHub Actions

After this branch is merged to the default branch,
`.github/workflows/navigation-performance.yml` runs daily at 19:17 UTC and can
also be started manually. The schedule is not active from an unmerged feature
branch.

Manual inputs:

- `expected_release_sha`: optional exact production SHA; otherwise the checked
  out commit is required;
- `samples`: 1–50 measured samples per group, normally 20; and
- `enforce_budgets`: defaults to false and requires at least 20 samples.

Every run adds a Markdown summary and retains JSON/Markdown evidence for 30
days. Scheduled work is single-flight and never cancels an in-progress run.
If a navigation sample fails, both error artifacts retain only its allowlisted
profile, interaction, transition, warmup/measured sample label, failure stage,
and stable reason. Raw URLs, query strings, selectors, entity identifiers,
browser error text, stacks, and causes are never written to the artifacts or
stderr.

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
- post-click target RSC after a valid settled intent group points toward
  segment-cache or prefetch consumption; and
- low sample counts or a release mismatch invalidate the comparison.

Record baseline and enforcement decisions in
[`../performance.md`](../performance.md).
