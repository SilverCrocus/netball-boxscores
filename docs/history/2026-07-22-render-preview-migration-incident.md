# Render PR-preview migration incident

> Historical incident record. Do not copy its commit, service, migration, or
> checksum values into a new release without fresh verification.

## Summary

On 2026-07-22, an automatic Render preview for PR #52 inherited the production
database configuration and ran the then-unprotected pre-deploy migration
command. The preview applied the additive
`20260722000000_add_analytics_cache_epoch` migration to production. The
production migration ledger recorded completion at
`2026-07-22 05:31:39.151698+00`.

This was an automatic preview-side production mutation, not a manual action
from the later release-preparation work. The migration was additive and the
ledger was clean. It must remain in release evidence and must not be described
as “no production mutation.”

## Lineage

- Applying era/commit: `e9a252d`
- Historical Render PR preview service: `srv-d9g5akn7f7vs73eqt52g`
- Historical preview URL: `https://centrepass-pr-52.onrender.com`
- Historical base service: `srv-d71t7iaa214c73eaqmcg`
- Later observer commit: `1fb85fd`
- Migration guard introduction: `0895da8`

The later `1fb85fd` preview contained different migration bytes and only
observed preview behavior; it could not have created the production ledger row
described above.

## Permanent control

The checked-in pre-deploy guard now skips Prisma migrations for Render pull
request previews and only permits Render production migration execution for
the `main` branch with an explicit non-preview contract. Every future preview
must show the low-cardinality guard-skip evidence and must not invoke Prisma.

Do not roll back this historical migration. Verify its checksum and ledger
position through the current production migration verifier during each release.
