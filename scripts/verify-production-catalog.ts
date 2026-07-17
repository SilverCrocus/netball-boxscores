#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runProtectedPsql } from './lib/production-psql';

type CatalogKind = 'view' | 'materialized_view' | 'function' | 'trigger';

export interface CatalogObjectChecksum {
  kind: CatalogKind;
  identity: string;
  sha256: string;
}

interface CatalogManifest {
  schemaVersion: 1;
  hashAlgorithm: 'sha256';
  sourceProjectRef: string;
  sourceMigrationThrough: string;
  objects: CatalogObjectChecksum[];
}

export interface CatalogComparison {
  passed: boolean;
  expectedCount: number;
  actualCount: number;
  missing: string[];
  unexpected: string[];
  changed: string[];
  duplicates: string[];
}

const CATALOG_SQL = String.raw`
WITH objects AS (
  SELECT
    CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' END AS kind,
    format('%I.%I', n.nspname, c.relname) AS identity,
    pg_get_viewdef(c.oid, true) AS definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'analytics')
    AND c.relkind IN ('v', 'm')
  UNION ALL
  SELECT
    'function',
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    pg_get_functiondef(p.oid)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'analytics')
  UNION ALL
  SELECT
    'trigger',
    format('%I.%I.%I', n.nspname, c.relname, t.tgname),
    pg_get_triggerdef(t.oid, true)
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'analytics')
    AND NOT t.tgisinternal
)
SELECT concat_ws(
  E'\t',
  kind,
  replace(encode(convert_to(identity, 'UTF8'), 'base64'), E'\n', ''),
  replace(encode(convert_to(definition, 'UTF8'), 'base64'), E'\n', '')
)
FROM objects
ORDER BY kind, identity;
`;

function key(object: Pick<CatalogObjectChecksum, 'kind' | 'identity'>): string {
  return `${object.kind}:${object.identity}`;
}

export function catalogDefinitionChecksum(definition: string): string {
  return createHash('sha256').update(definition, 'utf8').digest('hex');
}

export function compareCatalog(
  expected: CatalogObjectChecksum[],
  actual: CatalogObjectChecksum[],
): CatalogComparison {
  const duplicateKeys: string[] = [];
  const mapObjects = (objects: CatalogObjectChecksum[]): Map<string, CatalogObjectChecksum> => {
    const mapped = new Map<string, CatalogObjectChecksum>();
    for (const object of objects) {
      const objectKey = key(object);
      if (mapped.has(objectKey)) duplicateKeys.push(objectKey);
      mapped.set(objectKey, object);
    }
    return mapped;
  };
  const expectedByKey = mapObjects(expected);
  const actualByKey = mapObjects(actual);
  const missing = [...expectedByKey.keys()]
    .filter((objectKey) => !actualByKey.has(objectKey))
    .sort((left, right) => left.localeCompare(right));
  const unexpected = [...actualByKey.keys()]
    .filter((objectKey) => !expectedByKey.has(objectKey))
    .sort((left, right) => left.localeCompare(right));
  const changed = [...expectedByKey.entries()]
    .filter(([objectKey, object]) => {
      const actualObject = actualByKey.get(objectKey);
      return actualObject !== undefined && actualObject.sha256 !== object.sha256;
    })
    .map(([objectKey]) => objectKey)
    .sort((left, right) => left.localeCompare(right));
  const duplicates = [...new Set(duplicateKeys)].sort((left, right) => left.localeCompare(right));
  return {
    passed: missing.length === 0
      && unexpected.length === 0
      && changed.length === 0
      && duplicates.length === 0,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    unexpected,
    changed,
    duplicates,
  };
}

export function parseCatalogOutput(output: string): CatalogObjectChecksum[] {
  if (!output.trim()) return [];
  return output.trim().split('\n').map((line) => {
    const [kind, encodedIdentity, encodedDefinition, ...extra] = line.split('\t');
    if (!kind || !encodedIdentity || !encodedDefinition || extra.length > 0) {
      throw new Error('catalog query returned an invalid row');
    }
    if (!['view', 'materialized_view', 'function', 'trigger'].includes(kind)) {
      throw new Error(`catalog query returned unsupported kind ${kind}`);
    }
    const identity = Buffer.from(encodedIdentity, 'base64').toString('utf8');
    const definition = Buffer.from(encodedDefinition, 'base64').toString('utf8');
    if (!identity || !definition || /[\r\n]/.test(identity)) {
      throw new Error('catalog query returned invalid object data');
    }
    return {
      kind: kind as CatalogKind,
      identity,
      sha256: catalogDefinitionChecksum(definition),
    };
  });
}

function validateManifest(value: unknown): CatalogManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('catalog manifest must be an object');
  }
  const candidate = value as Partial<CatalogManifest>;
  if (candidate.schemaVersion !== 1 || candidate.hashAlgorithm !== 'sha256') {
    throw new Error('catalog manifest has an unsupported contract');
  }
  if (!candidate.sourceProjectRef || !candidate.sourceMigrationThrough || !Array.isArray(candidate.objects)) {
    throw new Error('catalog manifest provenance is incomplete');
  }
  for (const object of candidate.objects) {
    if (!object || !['view', 'materialized_view', 'function', 'trigger'].includes(object.kind)
      || !object.identity || !/^[a-f0-9]{64}$/.test(object.sha256)) {
      throw new Error('catalog manifest contains an invalid object');
    }
  }
  return candidate as CatalogManifest;
}

function parseArguments(argv: string[]): string {
  if (argv.length === 0) return path.resolve('scripts/manifests/production-catalog.json');
  if (argv.length !== 2 || argv[0] !== '--manifest' || !argv[1]) {
    throw new Error('Usage: npm run verify:production-catalog -- [--manifest <FILE>]');
  }
  return path.resolve(argv[1]);
}

async function main(): Promise<void> {
  const manifestPath = parseArguments(process.argv.slice(2));
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
  const actual = parseCatalogOutput(runProtectedPsql(CATALOG_SQL));
  const comparison = compareCatalog(manifest.objects, actual);
  console.log(JSON.stringify({
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    service: process.env.PGSERVICE,
    manifest: {
      path: manifestPath,
      sourceProjectRef: manifest.sourceProjectRef,
      sourceMigrationThrough: manifest.sourceMigrationThrough,
    },
    objects: actual,
    ...comparison,
  }, null, 2));
  if (!comparison.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
