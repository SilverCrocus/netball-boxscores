import { describe, expect, it } from 'vitest';
import { formatMatchStage } from './match-label';

describe('formatMatchStage', () => {
  it('formats regular-season rounds', () => {
    expect(formatMatchStage(14, null)).toBe('Round 14');
  });

  it.each([
    ['SEMI', 'Semi Finals'],
    ['PRELIM', 'Preliminary Final'],
    ['GRAND', 'Grand Final'],
  ])('formats the %s finals stage', (code, label) => {
    expect(formatMatchStage(1, code)).toBe(label);
  });
});
