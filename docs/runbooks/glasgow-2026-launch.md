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

```bash
npm run db:prepare:glasgow
```

This is idempotent only while the edition is `DRAFT`. It refuses to modify a
`PUBLISHED` edition.

## 3. Validate and record the exact foundation preview

First run the database-free validation:

```bash
npm run db:import:glasgow -- data/glasgow-2026/v1/bundle.json --offline-preview
```

Then run the database-aware preview without writing canonical rows:

```bash
npm run db:import:glasgow -- data/glasgow-2026/v1/bundle.json
```

If both are clean, record the database-aware receipt:

```bash
npm run db:import:glasgow -- data/glasgow-2026/v1/bundle.json --record-preview
```

Keep the printed checksum and dry-run receipt ID in the release evidence.

## 4. Apply and reconcile while still DRAFT

```bash
npm run db:import:glasgow -- data/glasgow-2026/v1/bundle.json --apply
```

Re-running the exact bundle creates an audited replay receipt and performs no
duplicate canonical writes. A revised complete bundle closes any previously
active roster membership absent from the new snapshot by setting it to
`REPLACED` with `validTo`; it does not delete the history.

Run the publication readiness dry-run:

```bash
npm run db:publish:edition -- commonwealth-games-netball glasgow-2026 --dry-run
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
npm run db:publish:edition -- commonwealth-games-netball glasgow-2026 --apply --confirm <TOKEN>
```

The token binds publication to the edition, expected bundle checksum, latest
applied foundation receipt, latest clean dry-run receipt, and source manifest.
Any intervening change invalidates it and requires a new dry-run.

## 7. Post-publication smoke

Verify health/readiness, SSN routes, Glasgow landing/schedule/pools/standings/
bracket/teams, authentication, mobile navigation, and canonical URLs. Start log
monitoring and nominate the operator responsible for the first results update.

If a critical invariant fails, follow `glasgow-2026-rollback.md` immediately.
