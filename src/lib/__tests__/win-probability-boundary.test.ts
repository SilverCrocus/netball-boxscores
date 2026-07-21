import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculateWinProbability,
  type WinProbabilityInput,
} from '@/lib/win-probability-client';

const sourceRoot = resolve(process.cwd(), 'src');
const liveClientPath = resolve(
  sourceRoot,
  'app/match/[matchId]/live/LiveGameClient.tsx',
);
const clientEntryPath = resolve(sourceRoot, 'lib/win-probability-client.ts');

const forbiddenServerOnlyTokens = [
  '@/lib/competitions',
  '@/lib/cached-queries',
  '@/lib/db',
  '@/lib/public-match',
  '@/lib/server-timing',
  '@prisma/client',
  'centrepass.server-timing',
  'next/cache',
  'node:async_hooks',
  'trackedUnstableCache',
  'unstable_cache',
];

function resolveLocalModule(specifier: string, importerPath: string): string | null {
  let modulePath: string;
  if (specifier.startsWith('@/')) {
    modulePath = resolve(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    modulePath = resolve(dirname(importerPath), specifier);
  } else {
    return null;
  }

  const candidates = [
    modulePath,
    modulePath + '.ts',
    modulePath + '.tsx',
    modulePath + '.js',
    modulePath + '.jsx',
    resolve(modulePath, 'index.ts'),
    resolve(modulePath, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /(?:^|\n)\s*import\s+(?!\()([\s\S]*?)(?:\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importPattern)) {
    specifiers.push(match[2]);
  }
  const dynamicImportPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(dynamicImportPattern)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function collectClientEntryGraph(entryPath: string): Map<string, string> {
  const modules = new Map<string, string>();
  const pending = [entryPath];

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (!modulePath || modules.has(modulePath)) continue;

    const source = readFileSync(modulePath, 'utf8');
    modules.set(modulePath, source);
    for (const specifier of importedSpecifiers(source)) {
      const dependencyPath = resolveLocalModule(specifier, modulePath);
      if (dependencyPath) pending.push(dependencyPath);
    }
  }

  return modules;
}

describe('live win probability client boundary', () => {
  it('imports the calculator from the browser-safe entrypoint', () => {
    const liveSource = readFileSync(liveClientPath, 'utf8');

    expect(liveSource).toMatch(
      /from ['"]@\/lib\/win-probability-client['"]/,
    );
    expect(liveSource).not.toMatch(
      /from ['"]@\/lib\/win-probability['"]/,
    );
  });

  it('keeps the client entry graph free of server-only dependencies', () => {
    const modules = collectClientEntryGraph(clientEntryPath);
    const violations: string[] = [];

    for (const [modulePath, source] of modules) {
      for (const token of forbiddenServerOnlyTokens) {
        if (source.includes(token)) {
          violations.push(modulePath + ': ' + token);
        }
      }
      for (const specifier of importedSpecifiers(source)) {
        for (const token of forbiddenServerOnlyTokens) {
          if (specifier === token) {
            violations.push(modulePath + ' imports ' + specifier);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('retains the live calculation behavior at the browser-safe entrypoint', () => {
    const input: WinProbabilityInput = {
      homeScore: 42,
      awayScore: 38,
      quarter: 2,
      periodSeconds: 300,
      scoreFlow: [],
      homeTeamId: 'home',
      prior: {
        expectedMargin: 2,
        homeAvgGoals: 64,
        awayAvgGoals: 62,
      },
    };

    expect(calculateWinProbability(input)).toMatchObject({
      awayWinPct: expect.any(Number),
      confidence: 'medium',
      drawPct: 0,
    });
    expect(calculateWinProbability({ ...input, quarter: 1, periodSeconds: 119 }))
      .toBeNull();
    expect(calculateWinProbability({ ...input, quarter: 4, periodSeconds: 900 }))
      .toEqual({
        homeWinPct: 100,
        awayWinPct: 0,
        drawPct: 0,
        confidence: 'high',
      });
  });
});
