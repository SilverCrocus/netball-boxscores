import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { sourcePayloadChecksum } from '@/lib/sources/checksum';
import type { NormalizedCompetitionImport } from '@/lib/sources/types';

interface GlasgowSourceManifestFile {
  schemaVersion: number;
  bundleVersion: string;
  edition: string;
  generatedAt: string;
  bundleFile: string;
  bundleFileSha256: string;
  declarations: {
    publicationStatusPolicy: string;
    publicationBlockers: string[];
  };
  sources: Array<{
    id: string;
    url: string;
    purpose: string;
    retrievedAt: string;
    fetchStatus: string;
  }>;
}

export interface GlasgowFoundationSourceEvidence {
  bundleText: string;
  expectedImportChecksum: string;
  receiptMetadata: Prisma.InputJsonObject;
  publicationExpectation: GlasgowPublicationExpectation;
}

export interface GlasgowPublicationExpectation {
  importChecksum: string;
  bundleFileSha256: string;
  manifestFileSha256: string;
  sourceIds: string[];
  teamExternalIds: string[];
  playerExternalIds: string[];
  matchExternalIds: string[];
  canonicalPlayers: Array<{
    externalId: string;
    championDataPlayerId: number;
  }>;
  editionCoverage: Array<{
    capability: string;
    state: string;
  }>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Glasgow source manifest ${field} is required`);
  }
  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Loads and verifies the source manifest beside the selected Glasgow bundle.
 * The compact metadata returned here is copied into every dry-run/applied
 * receipt, while the immutable source bundle remains the checksum authority.
 */
export async function loadGlasgowFoundationSourceEvidence(
  bundlePath: string,
): Promise<GlasgowFoundationSourceEvidence> {
  const manifestPath = path.join(path.dirname(bundlePath), 'source-manifest.json');
  const [bundleText, manifestText] = await Promise.all([
    readFile(bundlePath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const bundle = JSON.parse(bundleText) as NormalizedCompetitionImport;
  const manifest = JSON.parse(manifestText) as GlasgowSourceManifestFile;

  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported Glasgow source manifest schema: ${manifest.schemaVersion}`);
  }
  if (manifest.edition !== 'glasgow-2026') {
    throw new Error(`Glasgow source manifest edition mismatch: ${manifest.edition}`);
  }
  if (
    bundle.context?.editionExternalId !== 'glasgow-2026'
    || bundle.context?.sourceKey !== 'glasgow-2026-public-data'
  ) {
    throw new Error('Glasgow source bundle context does not match the expected edition and source');
  }
  if (path.basename(bundlePath) !== requiredString(manifest.bundleFile, 'bundleFile')) {
    throw new Error('Glasgow source manifest does not describe the selected bundle file');
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.bundleFileSha256 ?? '')) {
    throw new Error('Glasgow source manifest bundleFileSha256 must be a SHA-256 digest');
  }
  if (sha256(bundleText) !== manifest.bundleFileSha256) {
    throw new Error('Glasgow source bundle checksum does not match source-manifest.json');
  }
  requiredString(manifest.bundleVersion, 'bundleVersion');
  if (Number.isNaN(Date.parse(requiredString(manifest.generatedAt, 'generatedAt')))) {
    throw new Error('Glasgow source manifest generatedAt must be an ISO datetime');
  }
  if (!manifest.declarations || !Array.isArray(manifest.declarations.publicationBlockers)) {
    throw new Error('Glasgow source manifest declarations are invalid');
  }
  if (manifest.declarations.publicationStatusPolicy !== 'DRAFT_ONLY') {
    throw new Error('Glasgow source manifest must declare the DRAFT_ONLY publication policy');
  }
  if (manifest.declarations.publicationBlockers.length > 0) {
    throw new Error(
      `Glasgow source manifest still has publication blockers: ${manifest.declarations.publicationBlockers.join('; ')}`,
    );
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('Glasgow source manifest must contain provenance sources');
  }
  const sourceIdSet = new Set<string>();
  for (const [index, source] of manifest.sources.entries()) {
    if (!source || typeof source !== 'object') {
      throw new Error(`Glasgow source manifest sources[${index}] must be an object`);
    }
    const sourceId = requiredString(source.id, 'sources.id');
    if (sourceIdSet.has(sourceId)) {
      throw new Error(`Glasgow source manifest has duplicate source ID: ${sourceId}`);
    }
    sourceIdSet.add(sourceId);
    const sourceUrl = requiredString(source.url, `sources.${source.id}.url`);
    if (!isHttpUrl(sourceUrl)) {
      throw new Error(`Glasgow source manifest source ${source.id} must use an HTTP(S) URL`);
    }
    requiredString(source.purpose, `sources.${source.id}.purpose`);
    requiredString(source.fetchStatus, `sources.${source.id}.fetchStatus`);
    if (Number.isNaN(Date.parse(source.retrievedAt))) {
      throw new Error(`Glasgow source manifest source ${source.id} has an invalid retrievedAt`);
    }
  }

  const sourceIds = manifest.sources.map((source) => source.id).toSorted();
  const expectedImportChecksum = sourcePayloadChecksum(bundle);
  const manifestFileSha256 = sha256(manifestText);
  return {
    bundleText,
    expectedImportChecksum,
    receiptMetadata: {
      importKind: 'GLASGOW_FOUNDATION',
      sourceManifest: {
        schemaVersion: manifest.schemaVersion,
        bundleVersion: requiredString(manifest.bundleVersion, 'bundleVersion'),
        edition: manifest.edition,
        generatedAt: requiredString(manifest.generatedAt, 'generatedAt'),
        bundleFile: manifest.bundleFile,
        bundleFileSha256: manifest.bundleFileSha256,
        manifestFileSha256,
        sourceCount: sourceIds.length,
        sourceIds,
        publicationStatusPolicy: manifest.declarations.publicationStatusPolicy,
      },
    },
    publicationExpectation: {
      importChecksum: expectedImportChecksum,
      bundleFileSha256: manifest.bundleFileSha256,
      manifestFileSha256,
      sourceIds,
      teamExternalIds: bundle.teams.map((team) => team.externalId).toSorted(),
      playerExternalIds: bundle.players.map((player) => player.externalId).toSorted(),
      matchExternalIds: bundle.matches.map((match) => match.externalId).toSorted(),
      canonicalPlayers: bundle.players.flatMap((player) => (
        player.canonicalChampionDataPlayerId === undefined
          ? []
          : [{
            externalId: player.externalId,
            championDataPlayerId: player.canonicalChampionDataPlayerId,
          }]
      )).toSorted((left, right) => left.externalId.localeCompare(right.externalId)),
      editionCoverage: bundle.coverage
        .filter((coverage) => !coverage.matchExternalId)
        .map((coverage) => ({ capability: coverage.capability, state: coverage.state }))
        .toSorted((left, right) => left.capability.localeCompare(right.capability)),
    },
  };
}
