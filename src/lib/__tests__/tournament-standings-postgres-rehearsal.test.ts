import { describe, expect, it } from 'vitest';
import {
  assertMeaningfulStandingsDirectoryReduction,
} from '../../../scripts/verify-tournament-standings-postgres';

describe('tournament standings PostgreSQL rehearsal contract', () => {
  it('requires an actual two-read to one-statement directory reduction', () => {
    expect(assertMeaningfulStandingsDirectoryReduction(2, 1)).toEqual({
      reduction: 1,
      ratio: 0.5,
    });
  });

  it('rejects vacuous or non-reduced directory evidence', () => {
    expect(() => assertMeaningfulStandingsDirectoryReduction(1, 1))
      .toThrow('two logical reads');
    expect(() => assertMeaningfulStandingsDirectoryReduction(2, 2))
      .toThrow('one data statement');
  });
});
