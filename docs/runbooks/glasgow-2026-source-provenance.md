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
