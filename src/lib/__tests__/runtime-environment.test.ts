import { describe, expect, it } from 'vitest';
import { validateRuntimeEnvironment } from '@/lib/runtime-environment';

const productionEnvironment = {
  NODE_ENV: 'production',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:password@database.example.test:5432/centrepass',
  DIRECT_URL: 'postgresql://user:password@database.example.test:5432/centrepass',
  NEXTAUTH_URL: 'https://www.centrepass.io',
  NEXTAUTH_SECRET: 'a-valid-production-secret-with-32-characters',
  WORKER_ENABLED: 'true',
  DATABASE_ENVIRONMENT: 'production',
  ANALYTICS_FEATURES_ENABLED: 'false',
  ASK_CENTREPASS_ENABLED: 'false',
} as const;

describe('runtime environment validation', () => {
  it('accepts the fail-closed production baseline', () => {
    expect(validateRuntimeEnvironment(productionEnvironment)).toEqual([]);
  });

  it('rejects insecure production authentication and simulation configuration', () => {
    expect(validateRuntimeEnvironment({
      ...productionEnvironment,
      NEXTAUTH_URL: 'http://centrepass.example.test',
      NEXTAUTH_SECRET: 'generate-a-secret-here',
      SIMULATION_MODE: 'true',
      GOOGLE_CLIENT_ID: 'configured-without-secret',
    })).toEqual(expect.arrayContaining([
      'NEXTAUTH_URL must use HTTPS outside localhost',
      'NEXTAUTH_SECRET must be a non-placeholder secret of at least 32 characters in production',
      'SIMULATION_MODE cannot be enabled in production',
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together',
    ]));
  });

  it('requires scoped credentials and a valid kill-switch allowlist', () => {
    expect(validateRuntimeEnvironment({
      ...productionEnvironment,
      ANALYTICS_FEATURES_ENABLED: 'true',
      ASK_CENTREPASS_ENABLED: 'true',
      DRAFT_PREVIEW_ENABLED: 'true',
      DRAFT_PREVIEW_OPERATOR_IDS: 'operator-1,,operator-2',
      STATS_RATE_LIMIT_SECRET: 'placeholder-rate-limit-secret-value',
    })).toEqual(expect.arrayContaining([
      'ANALYTICS_DATABASE_URL must be a valid PostgreSQL URL when analytics is enabled',
      'STATS_OPERATIONS_DATABASE_URL must be a valid PostgreSQL URL when Ask CentrePass is enabled',
      'STATS_RATE_LIMIT_SECRET must be a non-placeholder secret of at least 32 characters when Ask CentrePass is enabled',
      'DRAFT_PREVIEW_OPERATOR_IDS must contain only stable comma-separated user IDs when preview is enabled',
    ]));
  });

  it('rejects credential-bearing upstream URLs without echoing credentials', () => {
    const errors = validateRuntimeEnvironment({
      ...productionEnvironment,
      CHAMPION_DATA_BASE_URL: 'https://worker:not-a-real-secret@upstream.example/data',
      THESPORTSDB_BASE_URL: 'https://api:not-a-real-key@upstream.example/data',
    });

    expect(errors).toEqual(expect.arrayContaining([
      'CHAMPION_DATA_BASE_URL must not include URL credentials',
      'THESPORTSDB_BASE_URL must not include URL credentials',
    ]));
    expect(errors.join(' ')).not.toContain('not-a-real-secret');
    expect(errors.join(' ')).not.toContain('not-a-real-key');
  });
});
