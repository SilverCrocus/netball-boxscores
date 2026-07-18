# Glasgow 2026 source provenance runbook

Every production import must be explainable from a captured source manifest and
immutable receipt. A successful database write is not evidence that a result is
correct.

## Foundation bundle

The checked-in artifacts are:

- `data/glasgow-2026/v1/bundle.json`
- `data/glasgow-2026/v1/source-manifest.json`

The importer verifies the sidecar schema, edition, bundle filename, raw-file
SHA-256, DRAFT-only policy, empty publication-blocker list, source IDs, URLs,
purposes, and retrieval timestamps. Each dry-run/applied receipt records a
compact manifest containing bundle/manifest checksums, bundle version, source
count/IDs, generation time, and publication policy. The source snapshot retains
the permitted normalized payload.

### v1 evidence boundary

The v1 manifest is a referenced-source ledger, not an immutable capture of the
44 non-photo upstream webpages. Its entries are intentionally marked `REFERENCED`; they
do not contain per-source response hashes or raw HTML/PDF snapshots. A matching
CentrePass receipt therefore proves which normalized bundle and source ledger
were imported, but it does not independently prove what every upstream page
contained at collection time.

Use the wording **referenced and manually revalidated sources** in release
evidence. Do not describe v1 as a verified or reproducible source capture. On
launch day, revalidate the complete official schedule, the final imported
squads, and every reused player-photo licence against the URLs in the manifest.
Record the revalidation time and operator alongside the dry-run/apply receipts.
Any discrepancy blocks publication until a corrected, versioned bundle is
generated and rehearsed again.

The launch-day revalidation timestamp embedded in v1 is
`2026-07-18T00:00:00.000Z`. Uganda's final 12-player identities are supported by
the Swift Sports and Kawowo reports in the manifest. The earlier New Vision URL
is retained only as historical evidence of the 15-player South Africa
preparation squad and must not be described as the final Glasgow squad. Uganda
remains unimported because the referenced sources do not establish one exact
primary position for every player; the manifest records the final identities
without inventing player or roster rows.

A future bundle may strengthen this boundary with per-source HTTP status,
content type, capture time, content SHA-256, and a permitted raw or normalized
evidence artifact. Those fields must be added as a new manifest version rather
than retroactively rewriting v1 evidence.

Do not hand-edit only the generated JSON. Update
`scripts/build-glasgow-2026-source-bundle.mjs`, regenerate both files, review the
diff, and repeat checksum/tests. Preserve unknown squad positions as unavailable.

## Results manifests

Each results JSON embeds its own versioned `sourceManifest`:

- `checksum` is the SHA-256 of the captured source artifact or normalized source
  evidence file, not a made-up identifier;
- every source has a stable ID, HTTP(S) URL, retrieval timestamp, and purpose;
- `retrievedAt` records CentrePass collection time, while each match
  `sourceUpdatedAt` records the source's result timestamp where available.

The receipt and source snapshot retain this metadata and the normalized results
payload only when source configuration permits raw-payload storage.

## Player images

Player-photo reuse remains separate from factual match data. Retain the image
source page, creator credit, licence, verification timestamp, and displayed
modification disclosure. Do not infer image reuse rights from public visibility.

## Audit review

For every applied run, retain:

- dry-run and applied receipt IDs;
- normalized payload checksum and source-manifest checksum;
- exact source URLs and retrieval times;
- inserted/updated/skipped counts plus mutation-operation metadata;
- correction base checksum/reason when applicable; and
- any unavailable capability declarations.

Never rewrite an old receipt to make later evidence look contemporaneous. Add a
new replay or compensating correction receipt instead.
