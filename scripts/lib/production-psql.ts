import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

const ALLOWED_LIBPQ_VARIABLES = new Set([
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGPASSFILE',
]);

function protectedFile(variable: 'PGSERVICEFILE' | 'PGPASSFILE', environment: NodeJS.ProcessEnv): string {
  const rawPath = environment[variable];
  if (!rawPath) throw new Error(`${variable} is required`);
  const resolvedPath = path.resolve(rawPath);
  if (resolvedPath !== rawPath) throw new Error(`${variable} must be an absolute path`);

  const details = statSync(resolvedPath);
  if (!details.isFile()) throw new Error(`${variable} must point to a regular file`);
  if ((details.mode & 0o077) !== 0) {
    throw new Error(`${variable} must not be readable, writable, or executable by group/other users`);
  }
  return resolvedPath;
}

export function validateProtectedLibpqEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): { service: string; serviceFile: string; passwordFile: string } {
  const service = environment.PGSERVICE;
  if (!service || !/^[A-Za-z0-9_.-]+$/.test(service)) {
    throw new Error('PGSERVICE must name the reviewed libpq service');
  }
  for (const variable of Object.keys(environment)) {
    if (variable.startsWith('PG') && !ALLOWED_LIBPQ_VARIABLES.has(variable)) {
      throw new Error(`${variable} must be unset so it cannot override the reviewed libpq service`);
    }
  }

  return {
    service,
    serviceFile: protectedFile('PGSERVICEFILE', environment),
    passwordFile: protectedFile('PGPASSFILE', environment),
  };
}

export function runProtectedPsql(
  sql: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  validateProtectedLibpqEnvironment(environment);
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
    env: environment,
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
