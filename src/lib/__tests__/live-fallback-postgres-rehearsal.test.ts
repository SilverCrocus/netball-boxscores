import { describe, expect, it } from 'vitest';
import {
  assertEphemeralPostgres17Target,
  assertMeaningfulRelationReduction,
} from '../../../scripts/verify-live-fallback-competition-postgres';

const loopbackTarget = {
  CENTREPASS_EPHEMERAL_PG17_REHEARSAL: 'true',
  DATABASE_URL: 'postgresql://postgres@127.0.0.1:5432/postgres',
  DIRECT_URL: 'postgresql://postgres@127.0.0.1:5432/postgres',
};

describe('Live fallback PostgreSQL rehearsal guard', () => {
  it('accepts only the explicitly opted-in loopback target', () => {
    expect(() => assertEphemeralPostgres17Target(loopbackTarget)).not.toThrow();
  });

  it('rejects missing opt-in and non-loopback database URLs', () => {
    expect(() => assertEphemeralPostgres17Target({
      ...loopbackTarget,
      CENTREPASS_EPHEMERAL_PG17_REHEARSAL: 'false',
    })).toThrow('CENTREPASS_EPHEMERAL_PG17_REHEARSAL=true');
    expect(() => assertEphemeralPostgres17Target({
      ...loopbackTarget,
      DATABASE_URL: 'postgresql://remote.example/production',
    })).toThrow('must target loopback PostgreSQL');
  });

  it('requires a fixture-derived meaningful reduction rather than any lower count', () => {
    expect(assertMeaningfulRelationReduction(12, 7)).toMatchObject({
      reduction: 5,
      minimumReduction: 3,
    });
    expect(() => assertMeaningfulRelationReduction(12, 11))
      .toThrow('relation join reduction is not meaningful');
  });
});
