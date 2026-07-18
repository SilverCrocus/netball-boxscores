import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProductionDatabaseUrl } from '../production-target-guard';

const REVIEWED_SERVICE = 'centrepass-production-direct';
const ALLOWED_LIBPQ_VARIABLES = new Set([
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGPASSFILE',
]);
const ALLOWED_SERVICE_KEYS = new Set([
  'dbname',
  'host',
  'port',
  'sslmode',
  'user',
]);
const INCLUDE_KEYS = new Set(['include', 'include_dir', 'include_if_exists']);

interface ReviewedServiceEntry {
  host: string;
  port: string;
  dbname: string;
  user: string;
  sslmode: string;
}

function protectedFile(variable: 'PGSERVICEFILE' | 'PGPASSFILE', environment: NodeJS.ProcessEnv): string {
  const rawPath = environment[variable];
  if (!rawPath) throw new Error(`${variable} is required`);
  const resolvedPath = path.resolve(rawPath);
  if (resolvedPath !== rawPath) throw new Error(`${variable} must be an absolute path`);

  if (lstatSync(resolvedPath).isSymbolicLink()) throw new Error(`${variable} must not be a symbolic link`);
  const details = statSync(resolvedPath);
  if (!details.isFile()) throw new Error(`${variable} must point to a regular file`);
  if (typeof process.getuid === 'function' && details.uid !== process.getuid()) {
    throw new Error(`${variable} must be owned by the current user`);
  }
  if ((details.mode & 0o077) !== 0) {
    throw new Error(`${variable} must not be readable, writable, or executable by group/other users`);
  }
  return resolvedPath;
}

function parseReviewedService(serviceFile: string): ReviewedServiceEntry {
  const sections = new Map<string, Map<string, string>>();
  let currentSection: Map<string, string> | null = null;
  for (const [index, rawLine] of readFileSync(serviceFile, 'utf8').split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1]?.trim();
      if (!name || sections.has(name)) {
        throw new Error(`PGSERVICEFILE contains an invalid or duplicate section at line ${index + 1}`);
      }
      currentSection = new Map();
      sections.set(name, currentSection);
      continue;
    }
    const separator = line.indexOf('=');
    if (!currentSection || separator <= 0) {
      throw new Error(`PGSERVICEFILE contains invalid syntax at line ${index + 1}`);
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (INCLUDE_KEYS.has(key)) throw new Error('PGSERVICEFILE must not include other configuration files');
    if (!ALLOWED_SERVICE_KEYS.has(key)) {
      throw new Error(`PGSERVICEFILE contains unreviewed key ${key}`);
    }
    if (!value || currentSection.has(key)) {
      throw new Error(`PGSERVICEFILE contains a missing value or duplicate key ${key}`);
    }
    currentSection.set(key, value);
  }

  if (sections.size !== 1 || !sections.has(REVIEWED_SERVICE)) {
    throw new Error(`PGSERVICEFILE must contain only [${REVIEWED_SERVICE}]`);
  }
  const selected = sections.get(REVIEWED_SERVICE)!;
  const required = ['host', 'port', 'dbname', 'user', 'sslmode'] as const;
  for (const key of required) {
    if (!selected.has(key)) throw new Error(`PGSERVICEFILE service is missing ${key}`);
  }
  if (selected.get('sslmode')?.toLowerCase() !== 'verify-full') {
    throw new Error('PGSERVICEFILE service must set sslmode=verify-full');
  }
  return Object.fromEntries(required.map((key) => [key, selected.get(key)!])) as unknown as ReviewedServiceEntry;
}

function splitPasswordLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      field += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === ':') {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }
  if (escaped) throw new Error('PGPASSFILE contains an invalid trailing escape');
  fields.push(field);
  return fields;
}

function validatePasswordFile(passwordFile: string, service: ReviewedServiceEntry): void {
  const rows = readFileSync(passwordFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  if (rows.length !== 1) throw new Error('PGPASSFILE must contain exactly one reviewed credential entry');
  const fields = splitPasswordLine(rows[0]!);
  if (fields.length !== 5 || fields.some((field) => !field)) {
    throw new Error('PGPASSFILE contains an invalid credential entry');
  }
  if (fields.slice(0, 4).some((field) => field === '*')) {
    throw new Error('PGPASSFILE must not contain wildcard target fields');
  }
  if (fields[0] !== service.host
    || fields[1] !== service.port
    || fields[2] !== service.dbname
    || fields[3] !== service.user) {
    throw new Error('PGPASSFILE credential entry does not match the reviewed service target');
  }
}

export function validateProtectedLibpqEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): { service: string; serviceFile: string; passwordFile: string; target: string; mode: string } {
  const service = environment.PGSERVICE;
  if (service !== REVIEWED_SERVICE) {
    throw new Error(`PGSERVICE must be ${REVIEWED_SERVICE}`);
  }
  for (const variable of Object.keys(environment)) {
    if (variable.startsWith('PG') && !ALLOWED_LIBPQ_VARIABLES.has(variable)) {
      throw new Error(`${variable} must be unset so it cannot override the reviewed libpq service`);
    }
  }
  const expectedProjectRef = environment.EXPECTED_PRODUCTION_PROJECT_REF?.toLowerCase();
  const rejectedProjectRef = environment.REJECTED_PREVIEW_PROJECT_REF?.toLowerCase();
  if (!expectedProjectRef || !rejectedProjectRef) {
    throw new Error('approved production and rejected preview project refs are required');
  }

  const serviceFile = protectedFile('PGSERVICEFILE', environment);
  const passwordFile = protectedFile('PGPASSFILE', environment);
  const selected = parseReviewedService(serviceFile);
  const encodedUser = encodeURIComponent(selected.user).replaceAll('.', '%2E');
  const target = validateProductionDatabaseUrl(
    'DIRECT_URL',
    `postgresql://${encodedUser}:protected@${selected.host}:${selected.port}/${selected.dbname}?sslmode=${encodeURIComponent(selected.sslmode)}`,
    expectedProjectRef,
    rejectedProjectRef,
  );
  validatePasswordFile(passwordFile, selected);

  return {
    service,
    serviceFile,
    passwordFile,
    target: target.projectRef,
    mode: target.mode,
  };
}

export function runProtectedPsql(
  sql: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  validateProtectedLibpqEnvironment(environment);
  const protectedEnvironment = { ...environment };
  for (const variable of [
    'DATABASE_URL',
    'DIRECT_URL',
    'ANALYTICS_DATABASE_URL',
    'STATS_OPERATIONS_DATABASE_URL',
  ]) delete protectedEnvironment[variable];
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    '--command',
    sql,
  ], {
    encoding: 'utf8',
    env: protectedEnvironment,
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });

  if (result.error) throw new Error(`psql could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit status ${String(result.status)}`;
    throw new Error(`psql query failed: ${detail}`);
  }
  return result.stdout;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: npm run guard:production-psql');
    const validated = validateProtectedLibpqEnvironment(process.env);
    console.log(JSON.stringify({
      service: validated.service,
      projectRef: validated.target,
      mode: validated.mode,
      passed: true,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
