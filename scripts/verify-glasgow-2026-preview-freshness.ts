import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  verifyPreviewDatabaseTarget,
  type PreviewDatabaseTargetEvidence,
} from './lib/preview-database-target';

export const GLASGOW_PREVIEW_BRANCH_ID = '29a1a5f9-8e67-46b0-8efe-89f32feb1ad4';
export const GLASGOW_PREVIEW_PROJECT_REF = 'xpfdjkqrbvdasjpllxnc';
export const GLASGOW_PRODUCTION_PROJECT_REF = 'iqnhnlttvnvkwrqvnrna';
export const GLASGOW_PREVIEW_RESET_MIGRATION = '20260715122711_remote_schema';

const SERIES_SLUG = 'commonwealth-games-netball';
const EDITION_SLUG = 'glasgow-2026';
const SOURCE_KEY = 'glasgow-2026-public-data';
const RULESET_SLUG = 'international-netball-2026';

export const GLASGOW_PREVIEW_RESET_INSTRUCTION = [
  `Reset only Supabase preview branch ${GLASGOW_PREVIEW_BRANCH_ID}`,
  `(ref ${GLASGOW_PREVIEW_PROJECT_REF})`,
  `to migration_version ${GLASGOW_PREVIEW_RESET_MIGRATION}`,
  `and rerun this rehearsal; never reset production ref ${GLASGOW_PRODUCTION_PROJECT_REF}.`,
].join(' ');

export interface GlasgowPreviewFreshnessCounts {
  importRuns: number;
  sourceSnapshots: number;
  sourceMappings: number;
  sourceSystem: number;
  foundationSeries: number;
  foundationRuleset: number;
  foundationCompetition: number;
  foundationEditionSources: number;
  foundationStages: number;
  foundationStageGroups: number;
  canonicalTeams: number;
  canonicalPlayers: number;
  canonicalEntries: number;
  canonicalRosters: number;
  canonicalMatches: number;
  canonicalMatchSlots: number;
  canonicalMatchQuarters: number;
  canonicalCoverage: number;
  canonicalImportMutations: number;
  canonicalImportIssues: number;
}

export interface GlasgowPreviewFreshnessResult {
  target: PreviewDatabaseTargetEvidence;
  counts: GlasgowPreviewFreshnessCounts;
}

const COMPETITION_WHERE = {
  slug: EDITION_SLUG,
  series: { slug: SERIES_SLUG },
};

const SOURCE_SYSTEM_WHERE = { key: SOURCE_KEY };

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function dirtyGlasgowPreviewCategories(
  counts: GlasgowPreviewFreshnessCounts,
): string[] {
  const foundation = sum([
    counts.sourceSystem,
    counts.foundationSeries,
    counts.foundationRuleset,
    counts.foundationCompetition,
    counts.foundationEditionSources,
    counts.foundationStages,
    counts.foundationStageGroups,
  ]);
  const canonical = sum([
    counts.canonicalTeams,
    counts.canonicalPlayers,
    counts.canonicalEntries,
    counts.canonicalRosters,
    counts.canonicalMatches,
    counts.canonicalMatchSlots,
    counts.canonicalMatchQuarters,
    counts.canonicalCoverage,
    counts.canonicalImportMutations,
    counts.canonicalImportIssues,
  ]);

  const categories: Array<[string, number]> = [
    ['import-runs', counts.importRuns],
    ['source-snapshots', counts.sourceSnapshots],
    ['source-mappings', counts.sourceMappings],
    ['foundation', foundation],
    ['canonical-state', canonical],
  ];
  return categories.filter(([, count]) => count > 0).map(([category]) => category);
}

export function assertGlasgowPreviewFresh(
  counts: GlasgowPreviewFreshnessCounts,
): void {
  const dirtyCategories = dirtyGlasgowPreviewCategories(counts);
  if (dirtyCategories.length > 0) {
    throw new Error([
      `Glasgow preview freshness preflight failed: ${dirtyCategories.join(', ')} are present.`,
      GLASGOW_PREVIEW_RESET_INSTRUCTION,
      'This read-only preflight did not delete or repair any data.',
    ].join(' '));
  }
}

export async function readGlasgowPreviewFreshness(
  database: PrismaClient,
): Promise<GlasgowPreviewFreshnessCounts> {
  const [
    importRuns,
    sourceSnapshots,
    sourceMappings,
    sourceSystem,
    foundationSeries,
    foundationRuleset,
    foundationCompetition,
    foundationEditionSources,
    foundationStages,
    foundationStageGroups,
    canonicalTeams,
    canonicalPlayers,
    canonicalEntries,
    canonicalRosters,
    canonicalMatches,
    canonicalMatchSlots,
    canonicalMatchQuarters,
    canonicalCoverage,
    canonicalImportMutations,
    canonicalImportIssues,
  ] = await Promise.all([
    // Deliberately do not filter ImportRun by status or dryRun: every receipt
    // is evidence that this disposable rehearsal target is not fresh.
    database.importRun.count({
      where: {
        sourceSystem: SOURCE_SYSTEM_WHERE,
        OR: [
          { competition: COMPETITION_WHERE },
          { editionSource: { competition: COMPETITION_WHERE } },
        ],
      },
    }),
    database.sourceSnapshot.count({
      where: {
        sourceSystem: SOURCE_SYSTEM_WHERE,
        OR: [
          { competition: COMPETITION_WHERE },
          { competitionId: null },
        ],
      },
    }),
    database.sourceEntityMapping.count({
      where: {
        sourceSystem: SOURCE_SYSTEM_WHERE,
        OR: [
          { competition: COMPETITION_WHERE },
          { competitionId: null },
        ],
      },
    }),
    database.sourceSystem.count({ where: SOURCE_SYSTEM_WHERE }),
    database.competitionSeries.count({ where: { slug: SERIES_SLUG } }),
    database.ruleset.count({ where: { slug: RULESET_SLUG } }),
    database.competition.count({ where: COMPETITION_WHERE }),
    database.editionSource.count({
      where: {
        competition: COMPETITION_WHERE,
        sourceSystem: SOURCE_SYSTEM_WHERE,
      },
    }),
    database.stage.count({ where: { competition: COMPETITION_WHERE } }),
    database.stageGroup.count({ where: { stage: { competition: COMPETITION_WHERE } } }),
    database.team.count({ where: { competition: COMPETITION_WHERE } }),
    database.player.count({ where: { team: { competition: COMPETITION_WHERE } } }),
    database.editionEntry.count({ where: { competition: COMPETITION_WHERE } }),
    database.rosterMembership.count({
      where: { editionEntry: { competition: COMPETITION_WHERE } },
    }),
    database.match.count({ where: { competition: COMPETITION_WHERE } }),
    database.matchSlot.count({ where: { match: { competition: COMPETITION_WHERE } } }),
    database.matchQuarter.count({ where: { match: { competition: COMPETITION_WHERE } } }),
    database.dataCoverage.count({ where: { competition: COMPETITION_WHERE } }),
    database.importMutation.count({
      where: {
        importRun: {
          sourceSystem: SOURCE_SYSTEM_WHERE,
          OR: [
            { competition: COMPETITION_WHERE },
            { editionSource: { competition: COMPETITION_WHERE } },
          ],
        },
      },
    }),
    database.importIssue.count({
      where: {
        importRun: {
          sourceSystem: SOURCE_SYSTEM_WHERE,
          OR: [
            { competition: COMPETITION_WHERE },
            { editionSource: { competition: COMPETITION_WHERE } },
          ],
        },
      },
    }),
  ]);

  return {
    importRuns,
    sourceSnapshots,
    sourceMappings,
    sourceSystem,
    foundationSeries,
    foundationRuleset,
    foundationCompetition,
    foundationEditionSources,
    foundationStages,
    foundationStageGroups,
    canonicalTeams,
    canonicalPlayers,
    canonicalEntries,
    canonicalRosters,
    canonicalMatches,
    canonicalMatchSlots,
    canonicalMatchQuarters,
    canonicalCoverage,
    canonicalImportMutations,
    canonicalImportIssues,
  };
}

export async function runGlasgowPreviewFreshnessPreflight(
  database: PrismaClient,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<GlasgowPreviewFreshnessResult> {
  const target = verifyPreviewDatabaseTarget(environment);
  const counts = await readGlasgowPreviewFreshness(database);
  assertGlasgowPreviewFresh(counts);
  return { target, counts };
}

async function main(): Promise<void> {
  const result = await runGlasgowPreviewFreshnessPreflight(prisma);
  console.log(JSON.stringify({
    status: 'verified-fresh-glasgow-preview',
    ...result,
  }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
