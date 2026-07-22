#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runProtectedPsql } from './lib/production-psql';

export type CatalogKind = 'view' | 'materialized_view' | 'function' | 'trigger';
type Scalar = boolean | string;
export type SecurityState = Record<string, Scalar | string[] | AclEntry[]>;

export interface AclEntry {
  grantor: string;
  grantee: string;
  privilege: string;
  grantable: boolean;
}

export interface CatalogObjectChecksum {
  kind: CatalogKind;
  identity: string;
  definitionSha256: string;
  securityStateSha256: string;
  sha256: string;
}

export interface CatalogObjectRecord extends CatalogObjectChecksum {
  securityState: SecurityState;
}

export interface ManifestProfile {
  kind: CatalogKind;
  state: SecurityState;
}

export interface ManifestObject {
  kind: CatalogKind;
  identity: string;
  definitionSha256: string;
  securityProfile: string;
}

export interface CatalogManifest {
  schemaVersion: 2;
  hashAlgorithm: 'sha256';
  sourceProjectRef: string;
  sourceMigrationThrough: string;
  securityProfiles: Record<string, ManifestProfile>;
  objects: ManifestObject[];
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

export const CATALOG_SQL = String.raw`
WITH objects AS (
  SELECT
    CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' END AS kind,
    format('%I.%I', n.nspname, c.relname) AS identity,
    pg_get_viewdef(c.oid, true) AS definition,
    jsonb_build_object(
      'owner', pg_get_userbyid(c.relowner),
      'acl', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'grantor', pg_get_userbyid(a.grantor),
          'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'privilege', a.privilege_type,
          'grantable', a.is_grantable
        ) ORDER BY pg_get_userbyid(a.grantor) COLLATE "C", (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C", a.privilege_type COLLATE "C", a.is_grantable)
        FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      ), '[]'::jsonb),
      'reloptions', to_jsonb(ARRAY(
        SELECT option FROM unnest(COALESCE(c.reloptions, ARRAY[]::text[])) option ORDER BY option
      ))
    ) AS security_state
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'analytics')
    AND c.relkind IN ('v', 'm')
  UNION ALL
  SELECT
    'function',
    format('%I.%I(%s)', n.nspname, p.proname, COALESCE((
      SELECT string_agg(format_type(arg.type_oid, NULL), ',' ORDER BY arg.ordinality)
      FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS arg(type_oid, ordinality)
    ), '')),
    pg_get_functiondef(p.oid),
    jsonb_build_object(
      'owner', pg_get_userbyid(p.proowner),
      'acl', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'grantor', pg_get_userbyid(a.grantor),
          'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'privilege', a.privilege_type,
          'grantable', a.is_grantable
        ) ORDER BY pg_get_userbyid(a.grantor) COLLATE "C", (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C", a.privilege_type COLLATE "C", a.is_grantable)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      ), '[]'::jsonb),
      'securityDefiner', p.prosecdef,
      'leakproof', p.proleakproof,
      'strict', p.proisstrict,
      'volatility', p.provolatile::text,
      'parallel', p.proparallel::text,
      'config', to_jsonb(ARRAY(
        SELECT setting FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) setting ORDER BY setting
      ))
    )
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'analytics')
  UNION ALL
  SELECT
    'trigger',
    format('%I.%I.%I', n.nspname, c.relname, t.tgname),
    pg_get_triggerdef(t.oid, true),
    jsonb_build_object(
      'owner', pg_get_userbyid(c.relowner),
      'acl', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'grantor', pg_get_userbyid(a.grantor),
          'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'privilege', a.privilege_type,
          'grantable', a.is_grantable
        ) ORDER BY pg_get_userbyid(a.grantor) COLLATE "C", (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C", a.privilege_type COLLATE "C", a.is_grantable)
        FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      ), '[]'::jsonb),
      'enabled', t.tgenabled::text
    )
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
  replace(encode(convert_to(definition, 'UTF8'), 'base64'), E'\n', ''),
  replace(encode(convert_to(security_state::text, 'UTF8'), 'base64'), E'\n', '')
)
FROM objects
ORDER BY kind COLLATE "C", identity COLLATE "C";
`;

const KIND_SECURITY_KEYS: Record<CatalogKind, string[]> = {
  view: ['acl', 'owner', 'reloptions'],
  materialized_view: ['acl', 'owner', 'reloptions'],
  function: ['acl', 'config', 'leakproof', 'owner', 'parallel', 'securityDefiner', 'strict', 'volatility'],
  trigger: ['acl', 'enabled', 'owner'],
};

function key(object: Pick<CatalogObjectChecksum, 'kind' | 'identity'>): string {
  return `${object.kind}:${object.identity}`;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const wanted = [...expected].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has missing or unreviewed fields`);
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort((left, right) => left.localeCompare(right))
      .map((property) => `${JSON.stringify(property)}:${canonicalJson(object[property])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function catalogDefinitionChecksum(definition: string): string {
  return checksum(definition);
}

export function catalogSecurityStateChecksum(state: SecurityState): string {
  return checksum(canonicalJson(state));
}

export function catalogObjectChecksum(definitionSha256: string, state: SecurityState): string {
  return checksum(canonicalJson({ definitionSha256, securityState: state }));
}

function validateAcl(value: unknown, label: string): asserts value is AclEntry[] {
  if (!Array.isArray(value)) throw new Error(`${label} ACL must be an array`);
  let previous = '';
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} ACL entry is invalid`);
    exactKeys(entry as Record<string, unknown>, ['grantor', 'grantee', 'privilege', 'grantable'], `${label} ACL entry`);
    const acl = entry as unknown as AclEntry;
    if (![acl.grantor, acl.grantee, acl.privilege].every((part) => typeof part === 'string' && part.length > 0)
      || typeof acl.grantable !== 'boolean') throw new Error(`${label} ACL entry is invalid`);
    const current = `${acl.grantor}\u0000${acl.grantee}\u0000${acl.privilege}\u0000${String(acl.grantable)}`;
    if (current <= previous) throw new Error(`${label} ACL entries must be unique and canonically ordered`);
    previous = current;
  }
}

function validateStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  for (let index = 1; index < value.length; index += 1) {
    if (value[index]! <= value[index - 1]!) throw new Error(`${label} must be unique and canonically ordered`);
  }
}

function validateSecurityState(kind: CatalogKind, value: unknown, label: string): SecurityState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const state = value as SecurityState;
  exactKeys(state, KIND_SECURITY_KEYS[kind], label);
  if (typeof state.owner !== 'string' || !state.owner) throw new Error(`${label} owner is invalid`);
  validateAcl(state.acl, label);
  if (kind === 'view' || kind === 'materialized_view') {
    validateStringArray(state.reloptions, `${label} reloptions`);
  } else if (kind === 'trigger') {
    if (typeof state.enabled !== 'string' || !/^[AODR]$/.test(state.enabled)) {
      throw new Error(`${label} enabled state is invalid`);
    }
  } else {
    validateStringArray(state.config, `${label} config`);
    if (typeof state.securityDefiner !== 'boolean' || typeof state.leakproof !== 'boolean'
      || typeof state.strict !== 'boolean' || typeof state.volatility !== 'string'
      || !/^[a-z]$/.test(state.volatility) || typeof state.parallel !== 'string'
      || !/^[a-z]$/.test(state.parallel)) throw new Error(`${label} function attributes are invalid`);
  }
  return state;
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
  const missing = [...expectedByKey.keys()].filter((objectKey) => !actualByKey.has(objectKey)).sort();
  const unexpected = [...actualByKey.keys()].filter((objectKey) => !expectedByKey.has(objectKey)).sort();
  const changed = [...expectedByKey.entries()]
    .filter(([objectKey, object]) => actualByKey.get(objectKey)?.sha256 !== object.sha256)
    .map(([objectKey]) => objectKey).sort();
  const duplicates = [...new Set(duplicateKeys)].sort();
  return {
    passed: missing.length === 0 && unexpected.length === 0 && changed.length === 0 && duplicates.length === 0,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing,
    unexpected,
    changed,
    duplicates,
  };
}

function catalogRow(
  kind: CatalogKind,
  identity: string,
  definitionSha256: string,
  state: SecurityState,
): CatalogObjectRecord {
  return {
    kind,
    identity,
    definitionSha256,
    securityStateSha256: catalogSecurityStateChecksum(state),
    sha256: catalogObjectChecksum(definitionSha256, state),
    securityState: state,
  };
}

export function parseCatalogRecords(output: string): CatalogObjectRecord[] {
  if (!output.trim()) return [];
  let previous = '';
  return output.trim().split('\n').map((line) => {
    const [kind, encodedIdentity, encodedDefinition, encodedState, ...extra] = line.split('\t');
    if (!kind || !encodedIdentity || !encodedDefinition || !encodedState || extra.length > 0
      || !['view', 'materialized_view', 'function', 'trigger'].includes(kind)) {
      throw new Error('catalog query returned an invalid row');
    }
    const identity = Buffer.from(encodedIdentity, 'base64').toString('utf8');
    const definition = Buffer.from(encodedDefinition, 'base64').toString('utf8');
    let parsedState: unknown;
    try {
      parsedState = JSON.parse(Buffer.from(encodedState, 'base64').toString('utf8')) as unknown;
    } catch {
      throw new Error('catalog query returned invalid security state');
    }
    if (!identity || !definition || /[\r\n]/.test(identity)) throw new Error('catalog query returned invalid object data');
    const objectKey = `${kind}:${identity}`;
    if (objectKey <= previous) throw new Error('catalog query rows must be unique and canonically ordered');
    previous = objectKey;
    const state = validateSecurityState(kind as CatalogKind, parsedState, `${objectKey} security state`);
    return catalogRow(kind as CatalogKind, identity, catalogDefinitionChecksum(definition), state);
  });
}

export function parseCatalogOutput(output: string): CatalogObjectChecksum[] {
  return parseCatalogRecords(output).map((object) => ({
    kind: object.kind,
    identity: object.identity,
    definitionSha256: object.definitionSha256,
    securityStateSha256: object.securityStateSha256,
    sha256: object.sha256,
  }));
}

export function validateManifest(value: unknown): CatalogManifest & { checksums: CatalogObjectChecksum[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('catalog manifest must be an object');
  const candidate = value as Record<string, unknown>;
  exactKeys(candidate, ['schemaVersion', 'hashAlgorithm', 'sourceProjectRef', 'sourceMigrationThrough', 'securityProfiles', 'objects'], 'catalog manifest');
  if (candidate.schemaVersion !== 2 || candidate.hashAlgorithm !== 'sha256') {
    throw new Error('catalog manifest has an unsupported contract');
  }
  if (typeof candidate.sourceProjectRef !== 'string' || !/^[a-z0-9]{20}$/.test(candidate.sourceProjectRef)
    || typeof candidate.sourceMigrationThrough !== 'string' || !candidate.sourceMigrationThrough
    || !candidate.securityProfiles || typeof candidate.securityProfiles !== 'object' || Array.isArray(candidate.securityProfiles)
    || !Array.isArray(candidate.objects) || candidate.objects.length === 0) {
    throw new Error('catalog manifest provenance or inventory is incomplete');
  }

  const profiles = candidate.securityProfiles as Record<string, unknown>;
  const profileNames = Object.keys(profiles);
  if (profileNames.length === 0 || JSON.stringify(profileNames) !== JSON.stringify([...profileNames].sort())) {
    throw new Error('catalog manifest security profiles must be nonempty and canonically ordered');
  }
  const validatedProfiles: Record<string, ManifestProfile> = {};
  for (const [name, rawProfile] of Object.entries(profiles)) {
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) throw new Error(`catalog profile ${name} is invalid`);
    exactKeys(rawProfile as Record<string, unknown>, ['kind', 'state'], `catalog profile ${name}`);
    const profile = rawProfile as { kind?: unknown; state?: unknown };
    if (typeof profile.kind !== 'string' || !['view', 'materialized_view', 'function', 'trigger'].includes(profile.kind)) {
      throw new Error(`catalog profile ${name} kind is invalid`);
    }
    validatedProfiles[name] = {
      kind: profile.kind as CatalogKind,
      state: validateSecurityState(profile.kind as CatalogKind, profile.state, `catalog profile ${name}`),
    };
  }

  let previous = '';
  const referencedProfiles = new Set<string>();
  const checksums = (candidate.objects as unknown[]).map((rawObject) => {
    if (!rawObject || typeof rawObject !== 'object' || Array.isArray(rawObject)) throw new Error('catalog manifest contains an invalid object');
    exactKeys(rawObject as Record<string, unknown>, ['kind', 'identity', 'definitionSha256', 'securityProfile'], 'catalog manifest object');
    const object = rawObject as unknown as ManifestObject;
    const profile = validatedProfiles[object.securityProfile];
    if (!['view', 'materialized_view', 'function', 'trigger'].includes(object.kind)
      || !object.identity || !/^[a-f0-9]{64}$/.test(object.definitionSha256)
      || !profile || profile.kind !== object.kind) throw new Error('catalog manifest contains an invalid object');
    referencedProfiles.add(object.securityProfile);
    const objectKey = `${object.kind}:${object.identity}`;
    if (objectKey <= previous) throw new Error('catalog manifest objects must be unique and canonically ordered');
    previous = objectKey;
    return catalogRow(object.kind, object.identity, object.definitionSha256, profile.state);
  });
  const unusedProfiles = profileNames.filter((name) => !referencedProfiles.has(name));
  if (unusedProfiles.length > 0) throw new Error('catalog manifest contains unused security profiles');

  return {
    schemaVersion: 2,
    hashAlgorithm: 'sha256',
    sourceProjectRef: candidate.sourceProjectRef as string,
    sourceMigrationThrough: candidate.sourceMigrationThrough as string,
    securityProfiles: validatedProfiles,
    objects: candidate.objects as ManifestObject[],
    checksums,
  };
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
  const comparison = compareCatalog(manifest.checksums, actual);
  console.log(JSON.stringify({
    schemaVersion: 2,
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
