import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as ts from 'typescript';
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
const winProbabilityBarPath = resolve(
  sourceRoot,
  'components/match/WinProbabilityBar.tsx',
);
const clientEntryPath = resolve(sourceRoot, 'lib/win-probability-client.ts');

const forbiddenRuntimeImports = [
  '@/lib/competitions',
  '@/lib/cached-queries',
  '@/lib/db',
  '@/lib/public-match',
  '@/lib/server-timing',
  '@/lib/win-probability',
  '@prisma/client',
];

const forbiddenSourceMarkers = [
  'canExposePublicMatchScore',
  'centrepass.server-timing',
  'getPublicCompetitions',
  'node:async_hooks',
  'resolvePublicMatchAccessBatch',
  'TEAM_STRENGTH_HISTORY_LIMIT',
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
    modulePath + '.mts',
    resolve(modulePath, 'index.ts'),
    resolve(modulePath, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runtimeModuleSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    'runtime-dependency-scan.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const specifiers: string[] = [];

  const addModuleSpecifier = (moduleSpecifier: ts.Expression | undefined) => {
    if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
      specifiers.push(moduleSpecifier.text);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const hasRuntimeImport = !clause || (
        !clause.isTypeOnly
        && (
          Boolean(clause.name)
          || !clause.namedBindings
          || ts.isNamespaceImport(clause.namedBindings)
          || (
            ts.isNamedImports(clause.namedBindings)
            && clause.namedBindings.elements.some((element) => !element.isTypeOnly)
          )
        )
      );
      if (hasRuntimeImport) addModuleSpecifier(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      const exportClause = node.exportClause;
      const hasRuntimeExport = !node.isTypeOnly && (
        !exportClause
        || ts.isNamespaceExport(exportClause)
        || (
          ts.isNamedExports(exportClause)
          && exportClause.elements.some((element) => !element.isTypeOnly)
        )
      );
      if (hasRuntimeExport) addModuleSpecifier(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      addModuleSpecifier(node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...new Set(specifiers)];
}

function collectRuntimeGraph(entryPath: string): Map<string, string> {
  const modules = new Map<string, string>();
  const pending = [entryPath];

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (!modulePath || modules.has(modulePath)) continue;

    const source = readFileSync(modulePath, 'utf8');
    modules.set(modulePath, source);
    for (const specifier of runtimeModuleSpecifiers(source)) {
      const dependencyPath = resolveLocalModule(specifier, modulePath);
      if (dependencyPath) pending.push(dependencyPath);
    }
  }

  return modules;
}

describe('live win probability client boundary', () => {
  it('parses runtime import/export edges without following erased type edges', () => {
    const source = [
      "import type { ServerType } from '@/lib/server-timing';",
      "import { type NamedType } from '@/lib/public-match';",
      "import { runtimeValue } from '@/lib/score-flow';",
      "export type { ServerType } from '@/lib/competitions';",
      "export { type NamedType } from '@/lib/db';",
      "export { runtimeValue } from '@/lib/stat-utils';",
      "export * from '@/lib/edition-links';",
      "export * as capabilities from '@/lib/edition-capabilities';",
    ].join('\n');

    expect(runtimeModuleSpecifiers(source)).toEqual([
      '@/lib/score-flow',
      '@/lib/stat-utils',
      '@/lib/edition-links',
      '@/lib/edition-capabilities',
    ]);
  });

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
    const modules = collectRuntimeGraph(liveClientPath);
    const violations: string[] = [];

    expect(modules.has(liveClientPath)).toBe(true);
    expect(modules.has(winProbabilityBarPath)).toBe(true);
    expect(modules.has(clientEntryPath)).toBe(true);
    expect(modules.size).toBeGreaterThan(3);

    for (const [modulePath, source] of modules) {
      for (const token of forbiddenSourceMarkers) {
        if (source.includes(token)) {
          violations.push(modulePath + ': ' + token);
        }
      }
      for (const specifier of runtimeModuleSpecifiers(source)) {
        if (forbiddenRuntimeImports.includes(specifier)) {
          violations.push(modulePath + ' imports ' + specifier);
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
