import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateWinProbability } from '@/lib/win-probability-client';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const clientModulePath = resolve(testDirectory, '../win-probability-client.ts');
const liveClientPath = resolve(
  testDirectory,
  '../../app/match/[matchId]/live/LiveGameClient.tsx',
);

describe('client-safe win probability module', () => {
  it('keeps the existing early-game and terminal behavior', () => {
    const baseInput = {
      homeScore: 42,
      awayScore: 38,
      periodSeconds: 0,
      scoreFlow: [],
      homeTeamId: 'home',
      prior: null,
    };

    expect(calculateWinProbability({ ...baseInput, quarter: 1 })).toBeNull();
    expect(calculateWinProbability({
      ...baseInput,
      quarter: 4,
      periodSeconds: 900,
    })).toEqual({
      homeWinPct: 100,
      awayWinPct: 0,
      drawPct: 0,
      confidence: 'high',
    });
  });

  it('produces a bounded live estimate from score flow and a prior', () => {
    const result = calculateWinProbability({
      homeScore: 42,
      awayScore: 38,
      quarter: 2,
      periodSeconds: 600,
      scoreFlow: [
        { period: 1, periodSeconds: 60, scoringTeamId: 'home', scorePoints: 1 },
        { period: 1, periodSeconds: 120, scoringTeamId: 'away', scorePoints: 2 },
        { period: 2, periodSeconds: 300, scoringTeamId: 'home', scorePoints: 1 },
      ],
      homeTeamId: 'home',
      prior: { expectedMargin: 2, homeAvgGoals: 65, awayAvgGoals: 60 },
    });

    expect(result).toMatchObject({ drawPct: 0, confidence: 'medium' });
    expect(result?.homeWinPct).toBeGreaterThanOrEqual(1);
    expect(result?.homeWinPct).toBeLessThanOrEqual(99);
    expect(result?.homeWinPct).toBeCloseTo(100 - (result?.awayWinPct ?? 0));
  });

  it('has no imports and is the direct Live client dependency', () => {
    const clientSource = readFileSync(clientModulePath, 'utf8');
    const liveClientSource = readFileSync(liveClientPath, 'utf8');

    expect(clientSource).not.toMatch(/^\s*import\s/m);
    expect(clientSource).not.toMatch(/\bfrom\s+['"]/);
    expect(liveClientSource).toContain(
      "from '@/lib/win-probability-client'",
    );
    expect(liveClientSource).not.toContain(
      "from '@/lib/win-probability'",
    );
  });
});
