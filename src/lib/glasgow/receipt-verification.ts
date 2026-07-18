import type { Prisma } from '@prisma/client';
import { sourcePayloadChecksum } from '@/lib/sources/checksum';

export interface GlasgowFoundationReceiptRow {
  id: string;
  sourceSystemId: string;
  competitionId: string | null;
  editionSourceId: string | null;
  trigger: 'MANUAL' | 'SCHEDULED' | 'REPLAY';
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'ROLLED_BACK';
  dryRun: boolean;
  startedAt: Date;
  completedAt: Date | null;
  checksum: string | null;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  issueCount: number;
  metadata: Prisma.JsonValue | null;
}

export interface GlasgowReceiptLineageExpectation {
  checksum: string;
  receiptMetadata: Prisma.InputJsonObject;
  importPolicy: Prisma.InputJsonObject;
  sourceIdentity: Prisma.InputJsonObject;
}

export interface VerifiedGlasgowReceiptLineage {
  rootRunId: string;
  replayReceiptIds: string[];
  previewStateFingerprints: string[];
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Glasgow receipt lineage failed: ${message}`);
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stableEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return sourcePayloadChecksum(left) === sourcePayloadChecksum(right);
}

/**
 * Proves the complete DRAFT rehearsal receipt lineage. Fingerprints are
 * independently recomputed from their stored structures so PostgreSQL jsonb
 * key ordering cannot create a false mismatch or conceal a changed policy.
 */
export function verifyGlasgowFoundationReceiptLineage(
  runs: GlasgowFoundationReceiptRow[],
  expectation: GlasgowReceiptLineageExpectation,
): VerifiedGlasgowReceiptLineage {
  invariant(runs.length > 0, 'foundation receipt history is empty');
  const expectedPolicyFingerprint = sourcePayloadChecksum(expectation.importPolicy);
  const expectedSourceIdentityFingerprint = sourcePayloadChecksum(expectation.sourceIdentity);
  const expectedProvenanceFingerprint = sourcePayloadChecksum(expectation.receiptMetadata);
  const expectedImportKind = expectation.receiptMetadata.importKind;
  const previewStateFingerprints = new Set<string>();

  for (const run of runs) {
    invariant(run.checksum === expectation.checksum, `receipt ${run.id} checksum is incorrect`);
    invariant(
      run.sourceSystemId === expectation.sourceIdentity.sourceSystemId
      && run.competitionId === expectation.sourceIdentity.competitionId
      && run.editionSourceId === expectation.sourceIdentity.editionSourceId,
      `receipt ${run.id} source identity columns are incorrect`,
    );
    invariant(run.completedAt !== null, `receipt ${run.id} is incomplete`);
    const metadata = jsonObject(run.metadata);
    invariant(metadata, `receipt ${run.id} metadata is invalid`);
    invariant(metadata.importKind === expectedImportKind, `receipt ${run.id} kind is incorrect`);
    for (const [key, expectedValue] of Object.entries(expectation.receiptMetadata)) {
      invariant(stableEqual(metadata[key], expectedValue),
        `receipt ${run.id} provenance field ${key} is incorrect`);
    }
    invariant(stableEqual(metadata.importPolicy, expectation.importPolicy),
      `receipt ${run.id} import policy is incorrect`);
    invariant(metadata.importPolicyFingerprint === expectedPolicyFingerprint,
      `receipt ${run.id} import policy fingerprint is incorrect`);
    invariant(stableEqual(metadata.sourceIdentity, expectation.sourceIdentity),
      `receipt ${run.id} source identity metadata is incorrect`);
    invariant(metadata.sourceIdentityFingerprint === expectedSourceIdentityFingerprint,
      `receipt ${run.id} source identity fingerprint is incorrect`);
    invariant(metadata.receiptProvenanceFingerprint === expectedProvenanceFingerprint,
      `receipt ${run.id} provenance fingerprint is incorrect`);
    const preview = jsonObject(metadata.preview);
    invariant(preview, `receipt ${run.id} preview metadata is missing`);
    const previewStateFingerprint = metadata.previewStateFingerprint;
    invariant(typeof previewStateFingerprint === 'string',
      `receipt ${run.id} preview-state fingerprint is missing`);
    invariant(previewStateFingerprint === sourcePayloadChecksum(preview),
      `receipt ${run.id} preview-state fingerprint is incorrect`);
    previewStateFingerprints.add(previewStateFingerprint);
  }

  const dryRuns = runs.filter((run) =>
    run.dryRun && run.status === 'SUCCEEDED' && run.issueCount === 0);
  invariant(dryRuns.length === 1,
    `expected one clean dry-run receipt, found ${dryRuns.length}`);
  const roots = runs.filter((run) =>
    !run.dryRun
    && run.status === 'SUCCEEDED'
    && run.trigger !== 'REPLAY'
    && run.issueCount === 0);
  invariant(roots.length === 1,
    `expected one authoritative applied receipt, found ${roots.length}`);
  const root = roots[0];
  const dryRun = dryRuns[0];
  invariant(dryRun.completedAt!.getTime() <= root.startedAt.getTime(),
    'clean dry-run receipt was not completed before the authoritative apply');
  const dryRunMetadata = jsonObject(dryRun.metadata)!;
  const rootMetadata = jsonObject(root.metadata)!;
  invariant(dryRunMetadata.previewRecorded === true,
    'clean dry-run receipt is not marked as recorded');
  invariant(
    dryRunMetadata.previewStateFingerprint === rootMetadata.previewStateFingerprint
    && stableEqual(dryRunMetadata.preview, rootMetadata.preview),
    'authoritative apply is not linked to the exact recorded preview state',
  );
  invariant(rootMetadata.replayOfImportRunId == null,
    'authoritative apply is incorrectly linked as a replay');
  invariant(root.insertedCount + root.updatedCount > 0,
    'authoritative apply did not record canonical writes');

  const replayRuns = runs.filter((run) =>
    !run.dryRun && run.status === 'SUCCEEDED' && run.trigger === 'REPLAY');
  invariant(replayRuns.length === 1,
    `expected one successful replay receipt, found ${replayRuns.length}`);
  for (const replay of replayRuns) {
    const metadata = jsonObject(replay.metadata)!;
    invariant(metadata.replayOfImportRunId === root.id,
      `replay receipt ${replay.id} does not reference the authoritative apply`);
    invariant(
      replay.insertedCount === 0
      && replay.updatedCount === 0
      && replay.skippedCount > 0,
      `replay receipt ${replay.id} is not a canonical no-op`,
    );
  }

  const controlledFailures = runs.filter((run) => {
    const metadata = jsonObject(run.metadata);
    return run.status === 'FAILED'
      && metadata?.controlledFailurePoint === 'BEFORE_AUDIT_FLUSH';
  });
  invariant(controlledFailures.length === 1,
    `expected one controlled rollback receipt, found ${controlledFailures.length}`);
  invariant(runs.filter((run) => run.status === 'FAILED').length === 1,
    'unexpected failed foundation receipt is present');
  invariant(
    runs.length === dryRuns.length + roots.length + replayRuns.length + controlledFailures.length,
    'unexpected foundation receipt state is present',
  );

  return {
    rootRunId: root.id,
    replayReceiptIds: replayRuns.map((run) => run.id),
    previewStateFingerprints: [...previewStateFingerprints].toSorted(),
  };
}
