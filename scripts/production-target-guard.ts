#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const REQUIRED_DATABASE_VARIABLES = ['DATABASE_URL', 'DIRECT_URL'] as const;
const SCOPED_DATABASE_VARIABLES = ['ANALYTICS_DATABASE_URL', 'STATS_OPERATIONS_DATABASE_URL'] as const;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const DIRECT_HOST_PATTERN = /^db\.([a-z0-9]{20})\.supabase\.co$/;
const SHARED_POOLER_HOST_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/;

export interface ProductionTargetResult {
  expectedProjectRef: string;
  targets: Record<string, string>;
}

export function projectRefFromDatabaseUrl(
  variable: string,
  rawUrl: string,
  expectedProjectRef: string,
  rejectedProjectRef: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${variable} is not a valid URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${variable} is not a PostgreSQL URL`);
  }
  let username: string;
  try {
    username = decodeURIComponent(parsed.username).toLowerCase();
  } catch {
    throw new Error(`${variable} has an invalid encoded username`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const candidates = [...new Set([
    ...hostname.split('.'),
    ...username.split('.'),
  ].filter((part) => PROJECT_REF_PATTERN.test(part)))];

  if (candidates.includes(rejectedProjectRef)) {
    throw new Error(`${variable} targets the rejected preview project`);
  }
  const directMatch = DIRECT_HOST_PATTERN.exec(hostname);
  const isSharedPooler = SHARED_POOLER_HOST_PATTERN.test(hostname);
  if (!directMatch && !isSharedPooler) {
    throw new Error(`${variable} is not an approved Supabase database or pooler endpoint`);
  }

  const routedProjectRefs = directMatch
    ? [directMatch[1]]
    : username.split('.').filter((part) => PROJECT_REF_PATTERN.test(part));
  if (routedProjectRefs.length !== 1
    || routedProjectRefs[0] !== expectedProjectRef
    || candidates.length !== 1
    || candidates[0] !== expectedProjectRef) {
    throw new Error(`${variable} does not resolve uniquely to the approved production project`);
  }
  return expectedProjectRef;
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
  for (const variable of variables) {
    const rawUrl = environment[variable];
    if (!rawUrl) throw new Error(`${variable} is missing`);
    targets[variable] = projectRefFromDatabaseUrl(
      variable,
      rawUrl,
      expectedProjectRef,
      rejectedProjectRef,
    );
  }

  const uniqueTargets = new Set(Object.values(targets));
  if (uniqueTargets.size !== 1 || !uniqueTargets.has(expectedProjectRef)) {
    throw new Error('database URLs do not all target the same approved production project');
  }
  return { expectedProjectRef, targets };
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
  console.log(JSON.stringify(result, null, 2));
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
