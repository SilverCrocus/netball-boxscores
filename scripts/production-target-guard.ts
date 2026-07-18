#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const REQUIRED_DATABASE_VARIABLES = ['DATABASE_URL', 'DIRECT_URL'] as const;
const SCOPED_DATABASE_VARIABLES = ['ANALYTICS_DATABASE_URL', 'STATS_OPERATIONS_DATABASE_URL'] as const;
const DATABASE_VARIABLES = [...REQUIRED_DATABASE_VARIABLES, ...SCOPED_DATABASE_VARIABLES] as const;
export type ProductionDatabaseVariable = typeof DATABASE_VARIABLES[number];

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const DIRECT_HOST_PATTERN = /^db\.([a-z0-9]{20})\.supabase\.co$/;
// Supabase's shared pooler endpoints use names such as
// aws-0-ap-southeast-2.pooler.supabase.com. Keep this deliberately narrower
// than a generic subdomain so lookalike suffixes and injected labels fail shut.
const SHARED_POOLER_HOST_PATTERN = /^aws-\d+-[a-z]{2}-[a-z]+-\d+\.pooler\.supabase\.com$/;
const COMMON_QUERY_PARAMETERS = new Set(['connect_timeout', 'sslmode']);
const TRANSACTION_QUERY_PARAMETERS = new Set([
  ...COMMON_QUERY_PARAMETERS,
  'connection_limit',
  'pgbouncer',
  'pool_timeout',
]);

export interface ValidatedProductionTarget {
  projectRef: string;
  mode: 'direct' | 'session' | 'transaction';
  host: string;
  port: number;
  database: 'postgres';
  role: 'postgres' | 'centrepass_analytics' | 'centrepass_stats_operations';
}

export interface ProductionTargetResult {
  expectedProjectRef: string;
  targets: Record<string, string>;
  routing: Record<string, ValidatedProductionTarget>;
}

function decodeUsername(variable: string, encodedUsername: string): string {
  let username: string;
  try {
    username = decodeURIComponent(encodedUsername).toLowerCase();
  } catch {
    throw new Error(`${variable} has an invalid encoded username`);
  }
  if (!username || username.includes('%')) {
    throw new Error(`${variable} has an invalid or double-encoded username`);
  }
  return username;
}

function boundedPositiveInteger(
  variable: string,
  key: string,
  value: string | null,
  maximum: number,
): number | null {
  if (value === null) return null;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${variable} ${key} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${variable} ${key} must be at most ${maximum}`);
  }
  return parsed;
}

function validateConnectionParameters(
  variable: ProductionDatabaseVariable,
  parsed: URL,
  mode: ValidatedProductionTarget['mode'],
): void {
  const allowed = mode === 'transaction' ? TRANSACTION_QUERY_PARAMETERS : COMMON_QUERY_PARAMETERS;
  for (const key of parsed.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`${variable} contains an unreviewed connection parameter`);
    }
    if (parsed.searchParams.getAll(key).length !== 1) {
      throw new Error(`${variable} contains a duplicate connection parameter`);
    }
  }
  const sslmodes = parsed.searchParams.getAll('sslmode');
  if (sslmodes.length !== 1 || sslmodes[0]?.toLowerCase() !== 'verify-full') {
    throw new Error(`${variable} must set exactly one sslmode=verify-full`);
  }
  boundedPositiveInteger(variable, 'connect_timeout', parsed.searchParams.get('connect_timeout'), 30);

  if (mode !== 'transaction') return;
  if (parsed.searchParams.get('pgbouncer') !== 'true') {
    throw new Error(`${variable} transaction mode must set pgbouncer=true`);
  }
  if (variable === 'ANALYTICS_DATABASE_URL') {
    if (parsed.searchParams.get('connection_limit') !== '5'
      || parsed.searchParams.get('pool_timeout') !== '5') {
      throw new Error('ANALYTICS_DATABASE_URL must set connection_limit=5 and pool_timeout=5');
    }
    return;
  }
  if (variable === 'STATS_OPERATIONS_DATABASE_URL') {
    if (parsed.searchParams.get('connection_limit') !== '2'
      || parsed.searchParams.get('pool_timeout') !== '5') {
      throw new Error('STATS_OPERATIONS_DATABASE_URL must set connection_limit=2 and pool_timeout=5');
    }
    return;
  }
  boundedPositiveInteger(variable, 'connection_limit', parsed.searchParams.get('connection_limit'), 20);
  boundedPositiveInteger(variable, 'pool_timeout', parsed.searchParams.get('pool_timeout'), 30);
}

export function validateProductionDatabaseUrl(
  variable: ProductionDatabaseVariable,
  rawUrl: string,
  expectedProjectRef: string,
  rejectedProjectRef: string,
): ValidatedProductionTarget {
  if (!PROJECT_REF_PATTERN.test(expectedProjectRef)
    || !PROJECT_REF_PATTERN.test(rejectedProjectRef)
    || expectedProjectRef === rejectedProjectRef) {
    throw new Error('approved production and rejected preview project refs are invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${variable} is not a valid URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${variable} is not a PostgreSQL URL`);
  }
  if (!parsed.password) throw new Error(`${variable} must contain a password`);
  if (parsed.hash) throw new Error(`${variable} must not contain a URL fragment`);
  if (parsed.pathname !== '/postgres') {
    throw new Error(`${variable} must target the postgres database`);
  }
  if (!parsed.port || !/^[0-9]+$/.test(parsed.port)) {
    throw new Error(`${variable} must use an explicit approved port`);
  }
  const username = decodeUsername(variable, parsed.username);
  const hostname = parsed.hostname.toLowerCase();
  const port = Number(parsed.port);
  const directMatch = DIRECT_HOST_PATTERN.exec(hostname);
  const isSharedPooler = SHARED_POOLER_HOST_PATTERN.test(hostname);
  if (!directMatch && !isSharedPooler) {
    throw new Error(`${variable} is not an approved Supabase database or pooler endpoint`);
  }

  const usernameParts = username.split('.');
  const routedRef = directMatch?.[1] ?? (usernameParts.length === 2 ? usernameParts[1] : undefined);
  const allRefs = [directMatch?.[1], ...usernameParts.filter((part) => PROJECT_REF_PATTERN.test(part))]
    .filter((part): part is string => Boolean(part));
  if (allRefs.includes(rejectedProjectRef)) {
    throw new Error(`${variable} targets the rejected preview project`);
  }
  if (!routedRef || routedRef !== expectedProjectRef || allRefs.some((ref) => ref !== expectedProjectRef)) {
    throw new Error(`${variable} does not resolve uniquely to the approved production project`);
  }

  let mode: ValidatedProductionTarget['mode'];
  let expectedRole: ValidatedProductionTarget['role'];
  if (variable === 'DIRECT_URL') {
    if (port !== 5432) throw new Error('DIRECT_URL must use direct/session port 5432');
    if (directMatch) {
      mode = 'direct';
      expectedRole = 'postgres';
      if (username !== expectedRole) throw new Error('DIRECT_URL direct endpoint must use the postgres role');
    } else {
      mode = 'session';
      expectedRole = 'postgres';
      if (username !== `${expectedRole}.${expectedProjectRef}`) {
        throw new Error('DIRECT_URL session endpoint must use the project-scoped postgres role');
      }
    }
  } else if (variable === 'DATABASE_URL') {
    if (port !== 6543) throw new Error('DATABASE_URL must use transaction port 6543');
    mode = 'transaction';
    expectedRole = 'postgres';
    if (directMatch) {
      if (username !== expectedRole) throw new Error('DATABASE_URL dedicated endpoint must use the postgres role');
    } else if (username !== `${expectedRole}.${expectedProjectRef}`) {
      throw new Error('DATABASE_URL shared pooler must use the project-scoped postgres role');
    }
  } else {
    if (!isSharedPooler || port !== 6543) {
      throw new Error(`${variable} must use a shared transaction pooler on port 6543`);
    }
    mode = 'transaction';
    expectedRole = variable === 'ANALYTICS_DATABASE_URL'
      ? 'centrepass_analytics'
      : 'centrepass_stats_operations';
    if (username !== `${expectedRole}.${expectedProjectRef}`) {
      throw new Error(`${variable} must use its project-scoped least-privilege role`);
    }
  }

  validateConnectionParameters(variable, parsed, mode);

  return {
    projectRef: expectedProjectRef,
    mode,
    host: hostname,
    port,
    database: 'postgres',
    role: expectedRole,
  };
}

export function projectRefFromDatabaseUrl(
  variable: string,
  rawUrl: string,
  expectedProjectRef: string,
  rejectedProjectRef: string,
): string {
  if (!DATABASE_VARIABLES.includes(variable as ProductionDatabaseVariable)) {
    throw new Error(`${variable} is not a reviewed production database variable`);
  }
  return validateProductionDatabaseUrl(
    variable as ProductionDatabaseVariable,
    rawUrl,
    expectedProjectRef,
    rejectedProjectRef,
  ).projectRef;
}

export function verifyProductionTargets(
  environment: NodeJS.ProcessEnv = process.env,
  includeScoped = false,
): ProductionTargetResult {
  const expectedProjectRef = environment.EXPECTED_PRODUCTION_PROJECT_REF?.toLowerCase();
  const rejectedProjectRef = environment.REJECTED_PREVIEW_PROJECT_REF?.toLowerCase();
  if (!expectedProjectRef || !PROJECT_REF_PATTERN.test(expectedProjectRef)) {
    throw new Error('EXPECTED_PRODUCTION_PROJECT_REF must be a 20-character project ref');
  }
  if (!rejectedProjectRef || !PROJECT_REF_PATTERN.test(rejectedProjectRef)) {
    throw new Error('REJECTED_PREVIEW_PROJECT_REF must be a 20-character project ref');
  }
  if (expectedProjectRef === rejectedProjectRef) {
    throw new Error('production and rejected preview project refs must differ');
  }

  const variables = includeScoped
    ? [...REQUIRED_DATABASE_VARIABLES, ...SCOPED_DATABASE_VARIABLES]
    : [...REQUIRED_DATABASE_VARIABLES];
  const targets: Record<string, string> = {};
  const routing: Record<string, ValidatedProductionTarget> = {};
  for (const variable of variables) {
    const rawUrl = environment[variable];
    if (!rawUrl) throw new Error(`${variable} is missing`);
    const validated = validateProductionDatabaseUrl(variable, rawUrl, expectedProjectRef, rejectedProjectRef);
    targets[variable] = validated.projectRef;
    routing[variable] = validated;
  }

  const uniqueTargets = new Set(Object.values(targets));
  if (uniqueTargets.size !== 1 || !uniqueTargets.has(expectedProjectRef)) {
    throw new Error('database URLs do not all target the same approved production project');
  }
  const sharedPoolerHosts = new Set(Object.values(routing)
    .filter((target) => target.host.endsWith('.pooler.supabase.com'))
    .map((target) => target.host));
  if (sharedPoolerHosts.size > 1) {
    throw new Error('shared pooler URLs do not all use the same approved region endpoint');
  }
  return { expectedProjectRef, targets, routing };
}

function main(): void {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.some((argument) => argument !== '--include-scoped')) {
    throw new Error('Usage: npm run guard:production-target -- [--include-scoped]');
  }
  if (argumentsList.filter((argument) => argument === '--include-scoped').length > 1) {
    throw new Error('Duplicate argument: --include-scoped');
  }
  const result = verifyProductionTargets(process.env, argumentsList.includes('--include-scoped'));
  console.log(JSON.stringify({
    expectedProjectRef: result.expectedProjectRef,
    targets: result.targets,
  }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
