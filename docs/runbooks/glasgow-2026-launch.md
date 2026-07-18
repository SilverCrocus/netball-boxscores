# Glasgow 2026 launch runbook

This runbook covers the explicit DRAFT-to-PUBLISHED launch sequence. It does
not authorize a production deployment or database mutation. Obtain the release
approval described in the main production-readiness plan before running these
commands against production.

## Invariants

- The edition remains `DRAFT` until the final publication command.
- Foundation data is loaded through the Prisma importer. The retired one-time
  SQL transport must not be used.
- The exact checked-in bundle and adjacent source manifest are used.
- A clean recorded dry-run is required before the matching apply.
- Publication requires 12 entries, 38 matches, 76 slots, 96 active roster
  memberships, complete source mappings, reviewed canonical-player reuse,
  complete coverage declarations, zero open validation errors, and matching
  source-manifest provenance.
- Imported data is never deleted as part of publication or emergency unpublish.

## 1. Pre-deployment gate

Verify the integration PR, CI, migration rehearsal, security checks, rollback
owner, and production approval. Deploy compatible migrations and the
edition-aware application before creating Glasgow production rows.

## 2. Prepare the unpublished foundation

Create a private target-evidence directory once for this release. Every
database-aware command below uses the allowlisted production wrapper, which
revalidates `DATABASE_URL` and `DIRECT_URL` in the same process immediately
before invoking the fixed Glasgow script. The evidence file is mode `0600`,
contains project refs only, and must be a new path for each attempt.

```bash
umask 077
mkdir -p "$RELEASE_EVIDENCE_DIR/glasgow/targets"
chmod 700 "$RELEASE_EVIDENCE_DIR/glasgow/targets"
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/prepare.json" \
  prepare
```

This is idempotent only while the edition is `DRAFT`. It refuses to modify a
`PUBLISHED` edition.

## 3. Validate and record the exact foundation preview

Before running the importer, follow the launch-day revalidation in
`glasgow-2026-source-provenance.md`: compare the full official schedule and
final squads with the checked-in bundle, and recheck every reused player-photo
licence. Record who performed the check and when. The v1 source ledger is
`REFERENCED`, not a set of immutable upstream-page captures, so an old preview
receipt cannot replace this current-source check.

First run the database-free validation:

```bash
npm run db:import:glasgow -- data/glasgow-2026/v1/bundle.json --offline-preview
```

Then run the database-aware preview without writing canonical rows:

```bash
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/foundation-preview.json" \
  foundation data/glasgow-2026/v1/bundle.json
```

If both are clean, record the database-aware receipt:

```bash
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/foundation-record-preview.json" \
  foundation data/glasgow-2026/v1/bundle.json --record-preview
```

Keep the printed checksum and dry-run receipt ID in the release evidence.

## 4. Apply and reconcile while still DRAFT

```bash
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/foundation-apply.json" \
  foundation data/glasgow-2026/v1/bundle.json --apply
```

Re-running the exact bundle creates an audited replay receipt and performs no
duplicate canonical writes. A revised complete bundle closes any previously
active roster membership absent from the new snapshot by setting it to
`REPLACED` with `validTo`; it does not delete the history.

Run the publication readiness dry-run:

```bash
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/publication-dry-run.json" \
  publish --dry-run
```

The command re-verifies every launch invariant and prints a confirmation token.
Do not continue if it reports a blocker.

## 5. Unpublished application smoke

Use the approved unpublished/admin access path to check schedule, pools,
standings empty state, bracket slots, teams, rosters, flags, time-zone display,
and SSN regression behavior. Missing result capabilities must remain
unavailable rather than appearing as zero-valued statistics.

## 6. Publish explicitly

Immediately after the successful dry-run, use its exact token:

```bash
npm run production:glasgow -- \
  --evidence-file "$RELEASE_EVIDENCE_DIR/glasgow/targets/publication-apply.json" \
  publish --apply --confirm <TOKEN>
```

The token binds publication to the edition, expected bundle checksum, latest
applied foundation receipt, latest clean dry-run receipt, and source manifest.
Any intervening change invalidates it and requires a new dry-run.
Never substitute the direct `db:prepare:glasgow`, `db:import:glasgow`, or
`db:publish:edition` scripts in a production session. They remain development
entrypoints and now fail closed when they detect the production environment or
production Supabase route without a fresh action-bound wrapper capability and
evidence file. The production wrapper is the executable target boundary.

## 7. Post-publication smoke

Verify health/readiness, SSN routes, Glasgow landing/schedule/pools/standings/
bracket/teams, authentication, mobile navigation, and canonical URLs. Start log
monitoring and nominate the operator responsible for the first results update.

If a critical invariant fails, follow `glasgow-2026-rollback.md` immediately.
