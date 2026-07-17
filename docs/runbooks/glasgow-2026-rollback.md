# Glasgow 2026 rollback and emergency unpublish runbook

Use this when Glasgow public pages or data are materially wrong. Emergency
unpublish is deliberately data-preserving: it changes the edition to `DRAFT`
and hides all stages, while retaining teams, rosters, matches, results,
coverage, source snapshots, and import audit history.

## Immediate containment

1. Stop new Glasgow foundation/results imports at the operational scheduler or
   operator level.
2. Capture the current deployment ID, logs, failing URLs, latest foundation and
   results receipt IDs/checksums, and incident time.
3. Run the explicit emergency command:

```bash
npm run db:unpublish:edition -- commonwealth-games-netball glasgow-2026 --confirm-unpublish
```

The command is idempotent for an already-DRAFT edition and refuses archived
editions. It does not execute a delete.

## Application rollback

If SSN or shared navigation is affected, roll the application back through the
approved deployment mechanism after unpublishing Glasgow. Do not roll database
schema back destructively; the competition migrations are additive and Glasgow
data can remain hidden.

## Data correction

- For result errors, use `glasgow-2026-compensating-correction.md` while the
  workflow state is reviewed. The published-results importer itself requires a
  published edition, so do not bypass it with direct SQL while Glasgow is
  hidden. If necessary, fix and verify in an approved preview copy first, then
  republish and apply the guarded correction in the agreed incident sequence.
- For foundation errors, prepare a revised complete bundle, record its preview,
  and apply it only while the edition is `DRAFT`. Missing former roster members
  are closed, not deleted.

## Republish

Re-run the entire publication readiness dry-run. A previous token cannot be
reused after evidence or receipt changes.

```bash
npm run db:publish:edition -- commonwealth-games-netball glasgow-2026 --dry-run
npm run db:publish:edition -- commonwealth-games-netball glasgow-2026 --apply --confirm <NEW_TOKEN>
```

Repeat production smoke tests and monitoring before closing the incident.
