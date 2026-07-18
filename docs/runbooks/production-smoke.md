# CentrePass production smoke and browser QA

The automated smoke is public, unauthenticated and read-only. It never submits
an Ask CentrePass question, signs in, creates a user, imports data, or changes
publication state. It verifies the Ask page plus the readiness probe for its
scoped database dependencies; the manual checklist exercises the interactive
query and authentication flows.

## Automated smoke

Required inputs are the public origin, the exact full Render commit SHA, an
explicit phase, and a durable evidence directory outside the repository.
Run `baseline` immediately after readiness while analytics/Ask are disabled and
before any Glasgow DRAFT write. Run `published` again after feature enablement
and Glasgow publication.

```bash
npm run smoke:production -- \
  --base-url https://www.centrepass.io \
  --expected-commit '<FULL_40_CHARACTER_RENDER_COMMIT>' \
  --phase '<baseline|published>' \
  --output-dir '<RELEASE_EVIDENCE_DIR>/smoke/<PHASE>' \
  --timeout-ms 8000 \
  --retries 2
```

The command exits non-zero on any failure and writes timestamped mode-`0600`
JSON and Markdown evidence. It checks:

- `/api/health`: `200`, liveness contract and exact `RENDER_GIT_COMMIT`;
- `/api/readiness`: `200`; database `ok=true`; worker `ok=true`, `enabled=true`,
  `required=true`, `state=healthy`, `satisfiesReadiness=true`, `isHealthy=true`,
  `lastPollStatus=success|empty`, a positive `currentIntervalMs`, and a fresh
  valid `lastPollAt`; plus the analytics/Ask boundaries in the state required
  by the selected phase;
- `/` plus `/api/matches?season=2026`: SSN renders and exposes a covered result;
- in `baseline`, Glasgow, rankings, records, comparison and Ask all return 404
  while their publication/feature controls are off;
- in `published`, Glasgow renders schedule context and `/rankings`, `/records`,
  `/compare/players`, `/explore` all render;
- a deliberately stale match-edition query redirects `307/308` to the owning
  canonical SSN edition.

Each check records only allowlisted evidence: expected/observed state, HTTP
status, attempts, latency, content type, same-origin final path/redirect path,
and body SHA-256. Response bodies are streamed under a strict byte ceiling and
are never retained in evidence. Oversized bodies and cross-origin redirects
fail closed. Network failures retain the exhausted attempt count and total
elapsed time even when no HTTP response was received.
Review the evidence; a generated file alone is not a pass.

## DRAFT Glasgow application verification

Inspect the exact deployed commit. If it implements
`/admin/preview/glasgow-2026`, pre-publication QA requires all of the following:

- keep `DRAFT_PREVIEW_ENABLED=false` and `DRAFT_PREVIEW_OPERATOR_IDS` absent
  before the window; configure the controlled Render operator list only while
  preparing the approved QA deployment;
- use unique stable NextAuth user IDs matching the 1-to-128-character syntax
  documented in [`production-environment.md`](production-environment.md), never email addresses, session
  IDs, provider metadata, an ad hoc account, or IDs copied into evidence;
- require exact lowercase `true`; any other enable value, missing list, empty
  list or malformed ID must remain denied;
- record authenticated authorized success plus unauthenticated and unauthorized
  denial, with the route's audit evidence;
- verify the rendered data remains DRAFT; and
- set `DRAFT_PREVIEW_ENABLED=false`, remove `DRAFT_PREVIEW_OPERATOR_IDS`, deploy
  immediately after QA, and prove access is denied again for anonymous,
  unallowlisted and previously authorized sessions.

If that route is absent from the deployed commit, or any part of this contract
cannot be proven, Glasgow publication remains **NO-GO**. Do not infer that the
route exists from this runbook, invent an admin URL, or temporarily publish the
edition for testing.

The database-only reconciliation/dry-run steps remain available through
[`glasgow-2026-launch.md`](glasgow-2026-launch.md), but they do not replace
rendered application QA.

## Manual browser checklist

Use a real browser at the production origin. Record screenshots, viewport,
browser/version, console errors, network errors and operator. Close browser
resources when finished.

### Desktop (at least 1440 x 900)

- [ ] Home/SSN results load; scores, teams, dates and match links are correct.
- [ ] Competition selector switches between SSN and published Glasgow without
      losing edition context.
- [ ] Glasgow schedule, pools, standings, bracket, teams, rosters and flags
      render; unavailable stats are labelled/hidden, never displayed as zero.
- [ ] Rankings, records and comparison controls work and show audit/coverage
      context.
- [ ] Ask CentrePass submits one deterministic supported question, returns an
      auditable answer, and reports no console/network error. Note that this
      intentionally consumes one rate-limit slot and writes privacy-bounded
      telemetry.
- [ ] A deliberately ambiguous Ask question requests clarification.
- [ ] A stale match edition URL redirects to the owning canonical edition.
- [ ] Keyboard-only navigation reaches selector, navigation, forms and primary
      actions with visible focus; headings, labels and landmarks are sensible.
- [ ] Browser accessibility inspection has no critical violations.

### Mobile (at least 390 x 844)

- [ ] Bottom navigation and overflow/more navigation are usable and do not
      obscure page actions.
- [ ] Competition selector, schedule cards, tables, bracket and comparison form
      do not overflow horizontally.
- [ ] Rankings/records/Ask inputs have readable labels and touch targets.
- [ ] Orientation/resize preserves selected edition and no content disappears.
- [ ] Authentication buttons and account/settings navigation remain reachable.

### Authentication and cleanup

- [ ] Existing approved test account can sign in and sign out.
- [ ] Protected `/settings` redirects an anonymous session to `/auth/signin`.
- [ ] Authenticated settings, favourites/reminders/team selection behave as
      expected without exposing another user's data.
- [ ] If signup is tested, use an approved disposable address, sign out, delete
      the user and related rows through the approved admin process, then verify
      the account no longer authenticates. Record the deletion evidence.
- [ ] No temporary user, OAuth grant, reminder, favourite or session remains.

Any critical failure is `NO-GO` or invokes
[`production-rollback.md`](production-rollback.md) after deployment.
