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
  `required=true`, `state=healthy`, `satisfiesReadiness=true`; and the
  analytics/Ask boundaries in the state required by the selected phase;
- `/` plus `/api/matches?season=2026`: SSN renders and exposes a covered result;
- in `baseline`, Glasgow, rankings, records, comparison and Ask all return 404
  while their publication/feature controls are off;
- in `published`, Glasgow renders schedule context and `/rankings`, `/records`,
  `/compare/players`, `/explore` all render;
- a deliberately stale match-edition query redirects `307/308` to the owning
  canonical SSN edition.

Each check records expected/observed state, HTTP status, attempts, latency,
content type, redirect location, body SHA-256 and a bounded public body sample.
Network failures retain the exhausted attempt count and total elapsed time even
when no HTTP response was received.
Review the evidence; a generated file alone is not a pass.

## DRAFT Glasgow application verification

No real guarded unpublished-view route exists in the current code. Public
edition and match resolvers intentionally hide DRAFT data. Therefore the
required pre-publication application check is a release blocker until an
authenticated, auditable route or an approved equivalent application path is
implemented. Do not invent an admin URL and do not temporarily publish the
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
