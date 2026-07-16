import { describe, expect, it } from 'vitest';
import { formatMatchStage } from './match-label';

describe('formatMatchStage', () => {
  it('formats regular-season rounds', () => {
    expect(formatMatchStage(14, null)).toBe('Round 14');
  });

  it('prefers an explicit tournament label over a numerical round or final code', () => {
    expect(formatMatchStage(2, 'SEMI', 'Pool A — 25 July', 'Pool Stage')).toBe('Pool A — 25 July');
  });

  it('falls back to the stage name when a tournament has no round label', () => {
    expect(formatMatchStage(null, null, null, 'Medal Matches')).toBe('Medal Matches');
  });

  it('uses a neutral fallback when no match context exists', () => {
    expect(formatMatchStage(null)).toBe('Match');
  });

  it.each([
    ['SEMI', 'Semi Finals'],
    ['PRELIM', 'Preliminary Final'],
    ['GRAND', 'Grand Final'],
  ])('formats the %s finals stage', (code, label) => {
    expect(formatMatchStage(1, code)).toBe(label);
  });
});
