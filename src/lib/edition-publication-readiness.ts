import type { PublicationStatus, StageType } from '@prisma/client';

export const MIN_PUBLIC_EDITION_TEAMS = 2;
export const MIN_PUBLIC_EDITION_MATCHES = 1;

export const GLASGOW_2026_IDENTITY = {
  competitionSlug: 'commonwealth-games-netball',
  editionSlug: 'glasgow-2026',
} as const;

const GLASGOW_2026_EXPECTED_STAGES = [
  { slug: 'pool-stage', type: 'POOL', sequence: 1, groupCount: 2, matchCount: 30 },
  { slug: 'classification', type: 'CLASSIFICATION', sequence: 2, groupCount: 0, matchCount: 4 },
  { slug: 'semi-finals', type: 'SEMI_FINALS', sequence: 3, groupCount: 0, matchCount: 2 },
  { slug: 'medal-matches', type: 'MEDAL_MATCHES', sequence: 4, groupCount: 0, matchCount: 2 },
] as const satisfies ReadonlyArray<{
  slug: string;
  type: StageType;
  sequence: number;
  groupCount: number;
  matchCount: number;
}>;

export interface EditionStagePublicationReadinessInput {
  slug: string;
  type: StageType;
  sequence: number;
  isPublished: boolean;
  groupCount: number;
  matchCount: number;
}

export interface EditionPublicationReadinessInput {
  competitionSlug?: string | null;
  editionSlug?: string | null;
  publicationStatus: PublicationStatus;
  teamCount: number;
  matchCount: number;
  matchSlotCount?: number;
  stages?: EditionStagePublicationReadinessInput[];
  cleanSuccessfulImportCount?: number;
  requirePublishedStages?: boolean;
}

export interface EditionPublicationReadiness {
  ready: boolean;
  blockers: string[];
}

export function isGlasgow2026Identity(input: {
  competitionSlug?: string | null;
  editionSlug?: string | null;
}): boolean {
  return input.competitionSlug === GLASGOW_2026_IDENTITY.competitionSlug
    && input.editionSlug === GLASGOW_2026_IDENTITY.editionSlug;
}

export function evaluateEditionPublicationReadiness(
  input: EditionPublicationReadinessInput,
): EditionPublicationReadiness {
  const blockers: string[] = [];
  const isGlasgow2026 = isGlasgow2026Identity(input);

  if (input.publicationStatus === 'ARCHIVED') {
    blockers.push('archived editions must be restored to draft before publication');
  }

  if (!isGlasgow2026) {
    if (input.teamCount < MIN_PUBLIC_EDITION_TEAMS) {
      blockers.push(`requires at least ${MIN_PUBLIC_EDITION_TEAMS} participating teams; found ${input.teamCount}`);
    }
    if (input.matchCount < MIN_PUBLIC_EDITION_MATCHES) {
      blockers.push(`requires at least ${MIN_PUBLIC_EDITION_MATCHES} match; found ${input.matchCount}`);
    }
    return { ready: blockers.length === 0, blockers };
  }

  if (input.teamCount !== 12) {
    blockers.push(`Glasgow 2026 requires exactly 12 participating teams; found ${input.teamCount}`);
  }
  if (input.matchCount !== 38) {
    blockers.push(`Glasgow 2026 requires exactly 38 matches; found ${input.matchCount}`);
  }
  if (input.matchSlotCount !== 76) {
    blockers.push(`Glasgow 2026 requires exactly 76 match slots; found ${input.matchSlotCount ?? 0}`);
  }
  if ((input.cleanSuccessfulImportCount ?? 0) < 1) {
    blockers.push('Glasgow 2026 requires a successful applied import with no recorded issues');
  }

  const stages = input.stages ?? [];
  const expectedStageSlugs = new Set<string>(GLASGOW_2026_EXPECTED_STAGES.map((stage) => stage.slug));
  const unexpectedStageSlugs = stages
    .map((stage) => stage.slug)
    .filter((slug) => !expectedStageSlugs.has(slug));
  if (unexpectedStageSlugs.length > 0) {
    blockers.push(`Glasgow 2026 has unexpected stages: ${unexpectedStageSlugs.join(', ')}`);
  }

  for (const expected of GLASGOW_2026_EXPECTED_STAGES) {
    const stage = stages.find((candidate) => candidate.slug === expected.slug);
    if (!stage) {
      blockers.push(`Glasgow 2026 is missing the ${expected.slug} stage`);
      continue;
    }
    if (
      stage.type !== expected.type
      || stage.sequence !== expected.sequence
      || stage.groupCount !== expected.groupCount
      || stage.matchCount !== expected.matchCount
    ) {
      blockers.push(
        `Glasgow 2026 stage ${expected.slug} must be ${expected.type} at sequence ${expected.sequence} with ${expected.groupCount} groups and ${expected.matchCount} matches`,
      );
    }
    if ((input.requirePublishedStages ?? input.publicationStatus === 'PUBLISHED') && !stage.isPublished) {
      blockers.push(`Glasgow 2026 stage ${expected.slug} must be published`);
    }
  }

  return { ready: blockers.length === 0, blockers };
}
