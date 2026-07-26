# Glasgow 2026 automatic live-results runbook

This is the normal production workflow for Glasgow 2026 scores. The existing
worker reads the official Commonwealth Sport feed on the server, validates each
observation, applies accepted changes through the governed Glasgow results
writer, and broadcasts the committed score. No operator should enter routine
live or final scores manually.

## Source and configuration

The adapter uses the Commonwealth Sport schedule API at
`https://api.commonwealthsport.com/cwg-schedule/v1/cwg`, competition
`3bb0d78e-d439-472a-a5bf-09b4e888aa04`, and discipline `NBL`. It first
discovers sessions for a Europe/London date, then requests the matching phase
details. Calls are server-side, uncached, time-bounded, response-size-bounded,
and limited to two concurrent detail requests.

Render must deploy these exact non-secret values:

| Variable | Production value | Purpose |
| --- | --- | --- |
| `WORKER_ENABLED` | `true` | Runs the existing background worker |
| `GLASGOW_LIVE_FEED_ENABLED` | `true` | Enables only the Glasgow official-feed adapter |
| `GLASGOW_LIVE_FEED_BASE_URL` | `https://api.commonwealthsport.com/cwg-schedule/v1/cwg` | Pins the reviewed upstream API base |

Only exact lowercase `true` enables either flag. Runtime validation rejects an
enabled Glasgow feed when the worker or base URL is missing, and rejects a base
URL containing credentials. The worker polls immediately at startup. Once a
match is live, its normal live cadence is 30 seconds; there is no separate
manual scheduler.

## Discovery, backfill, and identity

Every cycle requests the current and previous Europe/London dates. It also adds
the local date of each mapped fixture that is still `SCHEDULED` after its start
time, so a restart or upstream delay backfills overdue results automatically.
Every 15 minutes, and immediately after a worker restart, it also sweeps every
elapsed mapped tournament date for late official corrections. This keeps
corrections automatic without repeatedly downloading the full completed event
on the 30-second live-score cadence.
The newest 14 distinct dates are the safety bound; exceeding that bound reports
a partial poll for investigation.

The sync reuses the published foundation identities. It never creates a team,
entry, or match:

- series `commonwealth-games-netball`, edition and edition-source external ID
  `glasgow-2026`;
- active source key `glasgow-2026-public-data`; and
- existing `MATCH` and `TEAM` `SourceEntityMapping` rows for that source and
  edition.

An official result must resolve to exactly one match mapping whose external ID
begins with its Europe/London start-time prefix, `YYYY-MM-DD-HHmm-`. Both
official organisation codes must resolve through the existing team mappings
and agree with any participants already assigned to the match. Duplicate,
missing, or conflicting mappings are quarantined rather than guessed.
The only reviewed code translations are the provider's `MAW` to the bundle's
`MWI` for Malawi and `TGA` to `TON` for Tonga; all other codes must match
exactly.

## Accepted state transitions

| Official observation | Canonical write |
| --- | --- |
| `LIVE` / `RUNNING` with two valid scores | `LIVE` + `PROVISIONAL` |
| First `COMPLETE` / `OFFICIAL` observation | `COMPLETED` + `UNOFFICIAL_FINAL` |
| Second identical completed observation | Promote to `OFFICIAL_FINAL` |
| Changed score after completion | `CORRECTED`, with a compensating correction receipt |

A correction must cite the checksum of the latest successful applied
`GLASGOW_RESULTS` import. Without that checksum the changed result is
quarantined. An unchanged observation is skipped. A live score cannot decrease,
a completed match cannot be reopened by a live observation, and no unavailable
quarter, player, team, event, score-flow, Net Points, or lineup data is
invented.

The provider may expose a `LIVE` phase shell with both teams in
`GETTING_READY` and null scores before the first authoritative score arrives.
That shell is skipped. If a mapped fixture remains `SCHEDULED` for more than 15
minutes after kickoff, or a canonical `LIVE` fixture is missing from a
successfully fetched date, the cycle becomes `partial` so readiness and
monitoring surface the coverage gap. A completed match remains covered by this
check while it awaits the second identical snapshot required for
`OFFICIAL_FINAL` promotion.

The adapter fails closed on transport failure, timeout, invalid or oversized
JSON, incomplete or excluded session pages, unknown statuses, inconsistent
request/result identifiers, anything other than exactly two distinct mapped
teams, non-integer or negative scores, duplicate provider matches, ambiguous
fixture matches, participant conflicts, live score regression, or an
unsupported canonical state. A failed date or rejected observation makes the
cycle `partial` when other dates remain safe to apply. If no requested date
succeeds, the cycle is `error` and no score is written.

## Transaction, audit, and public behavior

Accepted results use the same serializable Glasgow writer as the guarded
manual importer. Each automated apply records:

- an `ImportRun` with trigger `SCHEDULED`, import kind `GLASGOW_RESULTS`, and
  automated metadata;
- a checksum plus the exact normalized provider IDs, teams, scores, status and
  times used to compute it, alongside actual session/detail URLs and retrieval
  times in the import receipt and `SourceSnapshot`;
- immutable `ImportMutation` rows for canonical changes; and
- match-specific `DataCoverage`, with `FINAL_SCORE` available and unsupported
  detail capabilities unavailable.

The same transaction updates the match, pool standings, and dependent
winner/loser bracket slots. Socket updates are emitted only after the canonical
commit. A score-only Glasgow live page is intentional and displays:
“Official live score coverage. Detailed player and play-by-play statistics are
not supplied by this feed.”

## Monitoring

During a Glasgow match, check:

```bash
curl --fail-with-body --silent --show-error \
  https://www.centrepass.io/api/health
curl --fail-with-body --silent --show-error \
  https://www.centrepass.io/api/readiness
curl --fail-with-body --silent --show-error \
  https://www.centrepass.io/api/worker-health
```

Require the deployed release identity, readiness `200`, a fresh worker
`lastPollAt`, `currentIntervalMs=30000` while live, and a last poll status of
`success` or `empty`. `partial` and `error` require immediate log and receipt
inspection. Confirm the public `/live` and match live page show the committed
score and the score-only disclosure when detailed capabilities are absent.
Use `ImportRun`, `SourceSnapshot`, and `ImportMutation` evidence to reconcile
the official observation; do not repair rows with direct SQL.

## Disable, rollback, and emergency manual fallback

For a Glasgow-feed-only defect, capture the deployment, endpoint responses,
worker state, affected match IDs, and receipt IDs, then set
`GLASGOW_LIVE_FEED_ENABLED=false` in Render and deploy the environment change.
Keep `WORKER_ENABLED=true` so SSN ingestion continues. Verify the worker remains
healthy and no new scheduled Glasgow import is created. Persisted accepted data
is retained.

If the whole worker is unsafe, follow
[`production-monitoring.md`](production-monitoring.md) and disable
`WORKER_ENABLED`; production readiness intentionally degrades until it is
restored. Roll application code back through the normal Render release process.
If public Glasgow data is materially unsafe, use
[`glasgow-2026-rollback.md`](glasgow-2026-rollback.md); never destructively roll
database state back.

The guarded workflow in
[`glasgow-2026-results.md`](glasgow-2026-results.md) is an emergency fallback,
not routine operations. Disable the Glasgow feed first, preserve the official
source artifact, run preview and recorded-preview validation, and use
[`glasgow-2026-compensating-correction.md`](glasgow-2026-compensating-correction.md)
for a changed completed result. Re-enable the feed only after the source or code
defect is fixed, deploy it, require a fresh successful poll and readiness
`200`, and compare a known match with the official source.
