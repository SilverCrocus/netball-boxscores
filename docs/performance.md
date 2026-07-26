# CentrePass performance status and roadmap

Status: current as of 2026-07-24. Production release at the audit point:
`da2f523e23dcaf89a56976fbc7dc5591963d3226`.

This document is the current performance roadmap. It replaces completed
implementation plans retained in Git history.

## Principles

- Measure server/data latency separately from client navigation feedback.
- Use at least 20 comparable successful samples before calling a result p50 or
  p95 evidence.
- Bind production evidence to the exact deployed release, route, cache state,
  device profile, and concurrency.
- Preserve publication, access, capability, and freshness policies while
  optimizing.
- Treat missing data as unavailable, never as zero.
- Do not introduce a new runtime or cache because one diagnostic request is
  slow; profile the actual bottleneck first.

## Implemented work

| Area | Current implementation | Evidence posture |
| --- | --- | --- |
| Server attribution | Request-local server operation, phase, query, and cache timing | Shipped; use the Live measurement runbook for new evidence |
| Live data path | Bounded fallback projections, snapshot-consistent selection, batched access checks, and Prisma relation joins | Shipped; continue exact-release production measurement |
| Standings | Fresh edition/readiness gate, joined legacy selector, and tagged canonical standings cache | Shipped; policy correctness remains mandatory even when cache is warm |
| Navigation feedback | Route loading states and link-local pending acknowledgement | Shipped |
| Navigation traffic | Intent-only full prefetch for Rankings/Records and no viewport prefetch for low-value destinations | Accepted by an exact-release navigation audit |
| Analytics snapshots | Versioned cache epoch, bounded snapshot size, explicit invalidation | Shipped; memory and correctness gates remain separate |
| Regression automation | Daily sequential Playwright monitor for Live, Standings, Rankings, and Records | Workflow checked in; its schedule runs from the default branch |

An earlier production sample did not meet its target: `/live` remained near
four seconds on the measured no-live path. That failed result is historical
evidence, not current acceptance. Subsequent relation-join and route-shape work
shipped to reduce round trips without changing data policy.

## Current automated monitor

The navigation monitor runs one journey at a time and covers:

- desktop pointer transitions across Records, Rankings, canonical Standings,
  Live, and back to Records;
- desktop keyboard intent for the two analytics transitions;
- mobile touch transitions;
- idle RSC request and byte volume;
- Save-Data and 2G prefetch policy;
- browser/runtime errors, same-origin request failures, HTTP 5xx, health,
  readiness, and release identity.

Initial budgets are:

- route-switch p95 at or below 2,000 ms;
- acknowledgement p95 at or below 150 ms;
- zero unexpected browser, request, or HTTP 5xx errors;
- no post-click target RSC request after a completed desktop intent prefetch;
- at most eight idle RSC requests and 20,000 completed idle RSC response-body
  bytes from a clean Records load.

Budgets remain report-only for the first 7–14 stable days. Monitor execution,
release mismatch, health/readiness failure, browser failure, or missing
evidence still fails the workflow.

## Latest diagnostic rehearsal

A one-sample read-only rehearsal against the exact production release completed
without unexpected runtime, request, or server errors. It is a safety check,
not a p95 result.

| Transition/profile | Diagnostic duration |
| --- | ---: |
| Desktop Records → Rankings | 216.5 ms |
| Desktop Rankings → Standings | 1,020.7 ms |
| Desktop Standings → Live | 1,921.8 ms |
| Desktop Live → Records | 148.0 ms |
| Mobile Records → Rankings | 2,415.3 ms |
| Mobile Rankings → Standings | 978.0 ms |
| Mobile Standings → Live | 1,956.3 ms |
| Mobile Live → Records | 1,504.0 ms |

The mobile Records → Rankings observation is the first investigation candidate
only if the scheduled 20-sample distributions repeatedly miss the budget.

The current Google Tag Manager CSP rejection is recorded separately as known
diagnostic noise. Every other console or page error remains a regression.
Correcting that CSP/analytics configuration should be handled as a separate
security/observability change rather than hidden in a performance patch.

## Next decision gates

1. Merge and activate the daily monitor.
2. Collect 7–14 days of comparable 20-sample reports.
3. Confirm whether mobile Records → Rankings or Standings → Live repeatedly
   misses the two-second p95 budget.
4. Correlate any repeated client miss with server operation/phase timing, RSC
   traffic, database statement counts, and Render/Supabase metrics.
5. Fix the narrow measured bottleneck and rerun the same matrix.
6. Enable budget enforcement only after the baseline is stable and the decision
   is recorded.

## Rust decision

Rust is not part of the current loading-time plan. The measured costs have been
database/network/RSC/render related rather than a dominant CPU-bound pure
function.

A Rust or WASM proof of concept is allowed only when a production profile names
one stable CPU-bound function and a representative benchmark corpus exists. It
must improve request-level performance by at least 20% without changing
correctness, security, deployment safety, or operability. Otherwise,
TypeScript, Next.js, Prisma, and PostgreSQL remain the simpler path.

## Measurement runbooks

- [Live server/data measurement](runbooks/live-performance-measurement.md)
- [Navigation regression monitoring](runbooks/navigation-performance-monitoring.md)
- [Production monitoring](runbooks/production-monitoring.md)
