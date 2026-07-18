import 'server-only';

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { buildEditionSchedule, editionScheduleMatchSelect } from '@/lib/edition-schedule';
import { GLASGOW_2026_IDENTITY } from '@/lib/edition-publication-readiness';
import type {
  TournamentBracketStage,
  TournamentPoolOverview,
} from '@/lib/tournament/types';

const previewTeamSelect = {
  id: true,
  name: true,
  slug: true,
  abbreviation: true,
  logoUrl: true,
} satisfies Prisma.TeamSelect;

const draftPreviewSelect = {
  id: true,
  name: true,
  season: true,
  slug: true,
  label: true,
  sourceTimezone: true,
  publicationStatus: true,
  series: {
    select: {
      name: true,
      slug: true,
      kind: true,
    },
  },
  dataCoverage: {
    where: { matchId: null },
    select: { capability: true, state: true },
  },
  entries: {
    where: { status: 'ACTIVE' as const },
    orderBy: [{ seed: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      seed: true,
      displayName: true,
      primaryGroup: { select: { id: true, name: true } },
      team: { select: previewTeamSelect },
      roster: {
        where: { status: 'ACTIVE' as const },
        orderBy: [{ player: { name: 'asc' as const } }, { id: 'asc' as const }],
        select: {
          id: true,
          bib: true,
          designatedPosition: true,
          isCaptain: true,
          player: {
            select: {
              id: true,
              name: true,
              position: true,
              nationality: true,
            },
          },
        },
      },
    },
  },
  stages: {
    orderBy: [{ sequence: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      sequence: true,
      isPublished: true,
      groups: {
        orderBy: [{ sequence: 'asc' as const }, { id: 'asc' as const }],
        select: {
          id: true,
          slug: true,
          name: true,
          sequence: true,
          primaryEntries: {
            where: { status: 'ACTIVE' as const },
            select: {
              id: true,
              seed: true,
              displayName: true,
              team: { select: previewTeamSelect },
            },
          },
        },
      },
    },
  },
  matches: {
    where: { isSimulation: false },
    orderBy: [{ scheduledAt: 'asc' as const }, { id: 'asc' as const }],
    select: editionScheduleMatchSelect,
  },
} satisfies Prisma.CompetitionSelect;

type DraftPreviewRecord = Prisma.CompetitionGetPayload<{ select: typeof draftPreviewSelect }>;
export type GlasgowDraftPreviewRoster = DraftPreviewRecord['entries'][number];

function buildPools(record: DraftPreviewRecord): TournamentPoolOverview | null {
  const poolStage = record.stages.find((stage) => stage.type === 'POOL');
  if (!poolStage) return null;

  const pools = poolStage.groups.map((group) => ({
    id: group.id,
    slug: group.slug,
    name: group.name,
    sequence: group.sequence,
    teams: group.primaryEntries
      .map((entry) => ({
        entryId: entry.id,
        teamId: entry.team.id,
        name: entry.team.name,
        displayName: entry.displayName?.trim() || entry.team.name,
        slug: entry.team.slug,
        abbreviation: entry.team.abbreviation,
        logoUrl: entry.team.logoUrl,
        seed: entry.seed,
      }))
      .sort((left, right) =>
        (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER)
          || left.displayName.localeCompare(right.displayName)),
  }));

  return {
    stageId: poolStage.id,
    stageName: poolStage.name,
    participantCount: pools.reduce((total, pool) => total + pool.teams.length, 0),
    pools,
  };
}

function buildBracket(
  schedule: ReturnType<typeof buildEditionSchedule>,
): TournamentBracketStage[] {
  return schedule.stages
    .filter((stage): stage is typeof stage & {
      type: TournamentBracketStage['type'];
    } => stage.type === 'CLASSIFICATION'
      || stage.type === 'SEMI_FINALS'
      || stage.type === 'MEDAL_MATCHES')
    .map((stage) => ({
      id: stage.id,
      slug: stage.slug,
      name: stage.name,
      type: stage.type,
      sequence: stage.sequence,
      matches: stage.dates.flatMap((date) => date.fixtures.map((fixture) => ({
        id: fixture.id,
        label: fixture.contextLabel,
        scheduledAt: fixture.scheduledAt.toISOString(),
        venue: fixture.venue,
        status: fixture.status,
        sideA: {
          side: 'A' as const,
          label: fixture.sideA.displayName,
          resolved: fixture.sideA.resolved,
          team: fixture.sideA.team,
          score: fixture.score?.sideA ?? null,
        },
        sideB: {
          side: 'B' as const,
          label: fixture.sideB.displayName,
          resolved: fixture.sideB.resolved,
          team: fixture.sideB.team,
          score: fixture.score?.sideB ?? null,
        },
      }))),
    }));
}

/** A deliberately uncached, read-only query for the guarded private preview. */
export async function loadGlasgowDraftPreview() {
  const record = await prisma.competition.findFirst({
    where: {
      publicationStatus: 'DRAFT',
      slug: GLASGOW_2026_IDENTITY.editionSlug,
      series: { is: { slug: GLASGOW_2026_IDENTITY.competitionSlug } },
    },
    select: draftPreviewSelect,
  });

  if (!record || !record.series) return null;

  const schedule = buildEditionSchedule({
    id: record.id,
    competitionName: record.series.name,
    editionLabel: record.label ?? String(record.season),
    competitionKind: record.series.kind,
    sourceTimezone: record.sourceTimezone,
    teamCount: record.entries.length,
    editionCoverage: record.dataCoverage,
  }, record.matches);

  return {
    edition: {
      id: record.id,
      name: record.series.name,
      label: record.label ?? String(record.season),
      publicationStatus: record.publicationStatus,
      unpublishedStageCount: record.stages.filter((stage) => !stage.isPublished).length,
    },
    schedule,
    pools: buildPools(record),
    bracket: buildBracket(schedule),
    rosters: record.entries,
    activeRosterCount: record.entries.reduce((total, entry) => total + entry.roster.length, 0),
  };
}

export type GlasgowDraftPreviewData = NonNullable<Awaited<ReturnType<typeof loadGlasgowDraftPreview>>>;
