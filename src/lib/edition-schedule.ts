import { unstable_cache } from 'next/cache';
import type {
  MatchStatus,
  Prisma,
  ResultQualityStatus,
  StageType,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import type { CompetitionOption } from '@/lib/competitions';
import { formatMatchStage } from '@/lib/match-label';

const scheduleTeamSelect = {
  id: true,
  name: true,
  slug: true,
  abbreviation: true,
  logoUrl: true,
} satisfies Prisma.TeamSelect;

export const editionScheduleMatchSelect = {
  id: true,
  scheduledAt: true,
  status: true,
  resultQuality: true,
  homeScore: true,
  awayScore: true,
  venue: true,
  neutralVenue: true,
  round: true,
  roundLabel: true,
  finalCode: true,
  homeTeam: { select: scheduleTeamSelect },
  awayTeam: { select: scheduleTeamSelect },
  stage: {
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      sequence: true,
    },
  },
  stageGroup: {
    select: {
      id: true,
      slug: true,
      name: true,
      sequence: true,
    },
  },
  slots: {
    select: {
      side: true,
      sourceLabel: true,
      resolvedEntry: {
        select: {
          displayName: true,
          team: { select: scheduleTeamSelect },
        },
      },
    },
    orderBy: { side: 'asc' },
  },
} satisfies Prisma.MatchSelect;

export type EditionScheduleMatchRecord = Prisma.MatchGetPayload<{
  select: typeof editionScheduleMatchSelect;
}>;

export interface EditionScheduleTeam {
  id: string;
  name: string;
  slug: string;
  abbreviation: string;
  logoUrl: string | null;
}

export interface EditionScheduleSide {
  side: 'A' | 'B';
  displayName: string;
  team: EditionScheduleTeam | null;
  resolved: boolean;
}

export interface EditionScheduleFixture {
  id: string;
  scheduledAt: Date;
  localDateLabel: string;
  localTimeLabel: string;
  status: MatchStatus;
  statusLabel: string;
  resultQuality: ResultQualityStatus;
  venue: string;
  neutralVenue: boolean;
  contextLabel: string;
  sideA: EditionScheduleSide;
  sideB: EditionScheduleSide;
  score: { sideA: number; sideB: number } | null;
  href: string | null;
}

export interface EditionScheduleDateGroup {
  key: string;
  label: string;
  fixtures: EditionScheduleFixture[];
}

export interface EditionScheduleStage {
  id: string;
  slug: string;
  name: string;
  type: StageType | null;
  sequence: number;
  fixtureCount: number;
  dates: EditionScheduleDateGroup[];
}

export interface EditionScheduleSummary {
  fixtureCount: number;
  teamCount: number;
  stageCount: number;
  scheduledCount: number;
  liveCount: number;
  completedCount: number;
  dateRangeLabel: string | null;
}

export interface EditionSchedule {
  editionId: string;
  competitionName: string;
  editionLabel: string;
  competitionKind: 'LEAGUE' | 'TOURNAMENT';
  sourceTimezone: string;
  timezoneLabel: string;
  summary: EditionScheduleSummary;
  stages: EditionScheduleStage[];
}

interface EditionScheduleIdentity {
  id: string;
  competitionName: string;
  editionLabel: string;
  competitionKind: 'LEAGUE' | 'TOURNAMENT';
  sourceTimezone: string;
  teamCount: number;
}

const STATUS_LABELS: Record<MatchStatus, string> = {
  SCHEDULED: 'Scheduled',
  LIVE: 'Live',
  COMPLETED: 'Final',
  DELAYED: 'Delayed',
  POSTPONED: 'Postponed',
  CANCELLED: 'Cancelled',
  ABANDONED: 'Abandoned',
};

const FALLBACK_STAGE_ID = 'edition-schedule';
const FALLBACK_STAGE_NAME = 'Full schedule';

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    key: `${value('year')}-${value('month')}-${value('day')}`,
    label: new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date),
  };
}

function localTimeLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

function timezoneLabel(date: Date | undefined, timeZone: string): string {
  if (!date) return timeZone;

  const part = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(date).find((item) => item.type === 'timeZoneName');

  return part?.value ?? timeZone;
}

function dateRangeLabel(
  first: Date | undefined,
  last: Date | undefined,
  timeZone: string,
): string | null {
  if (!first || !last) return null;

  const format = (date: Date) => new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);

  const firstLabel = format(first);
  const lastLabel = format(last);
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`;
}

function toTeam(team: EditionScheduleMatchRecord['homeTeam']): EditionScheduleTeam | null {
  if (!team) return null;
  return { ...team };
}

function displaySourceLabel(label: string | null | undefined): string | null {
  const value = label?.trim();
  if (!value) return null;

  // Preserve the official slot meaning without presenting "TBC" as if it
  // were a team name in the public fixture card.
  return value.replace(/\bTBC\b/gi, 'to be confirmed');
}

function projectSide(
  match: EditionScheduleMatchRecord,
  side: 'A' | 'B',
): EditionScheduleSide {
  const slot = match.slots.find((candidate) => candidate.side === side);
  const legacyTeam = side === 'A' ? match.homeTeam : match.awayTeam;
  const team = toTeam(slot?.resolvedEntry?.team ?? legacyTeam);
  const displayName = slot?.resolvedEntry?.displayName?.trim()
    || team?.name
    || displaySourceLabel(slot?.sourceLabel)
    || 'Participant pending official assignment';

  return {
    side,
    displayName,
    team,
    resolved: team !== null,
  };
}

function canShowScore(status: MatchStatus): boolean {
  return status === 'LIVE' || status === 'COMPLETED';
}

function projectFixture(
  match: EditionScheduleMatchRecord,
  timeZone: string,
): EditionScheduleFixture {
  const date = dateParts(match.scheduledAt, timeZone);
  const sideA = projectSide(match, 'A');
  const sideB = projectSide(match, 'B');
  const contextLabel = match.stageGroup?.name
    ?? formatMatchStage(match.round, match.finalCode, match.roundLabel, match.stage?.name);

  return {
    id: match.id,
    scheduledAt: match.scheduledAt,
    localDateLabel: date.label,
    localTimeLabel: localTimeLabel(match.scheduledAt, timeZone),
    status: match.status,
    statusLabel: STATUS_LABELS[match.status],
    resultQuality: match.resultQuality,
    venue: match.venue,
    neutralVenue: match.neutralVenue,
    contextLabel,
    sideA,
    sideB,
    score: canShowScore(match.status)
      ? { sideA: match.homeScore, sideB: match.awayScore }
      : null,
    href: sideA.resolved && sideB.resolved ? `/match/${match.id}` : null,
  };
}

/**
 * Convert canonical match records into a stable, timezone-aware schedule view.
 * The projection intentionally omits scores for every non-live/non-completed
 * fixture because database score defaults are not match results.
 */
export function buildEditionSchedule(
  edition: EditionScheduleIdentity,
  records: EditionScheduleMatchRecord[],
): EditionSchedule {
  const matches = [...records].sort((left, right) =>
    left.scheduledAt.getTime() - right.scheduledAt.getTime()
      || left.id.localeCompare(right.id)
  );
  const stageBuckets = new Map<string, {
    id: string;
    slug: string;
    name: string;
    type: StageType | null;
    sequence: number;
    fixtures: EditionScheduleFixture[];
  }>();

  for (const match of matches) {
    const stageId = match.stage?.id ?? FALLBACK_STAGE_ID;
    const bucket = stageBuckets.get(stageId) ?? {
      id: stageId,
      slug: match.stage?.slug ?? FALLBACK_STAGE_ID,
      name: match.stage?.name ?? FALLBACK_STAGE_NAME,
      type: match.stage?.type ?? null,
      sequence: match.stage?.sequence ?? Number.MAX_SAFE_INTEGER,
      fixtures: [],
    };
    bucket.fixtures.push(projectFixture(match, edition.sourceTimezone));
    stageBuckets.set(stageId, bucket);
  }

  const stages = [...stageBuckets.values()]
    .sort((left, right) => left.sequence - right.sequence || left.name.localeCompare(right.name))
    .map((stage): EditionScheduleStage => {
      const dates = new Map<string, EditionScheduleDateGroup>();
      for (const fixture of stage.fixtures) {
        const date = dateParts(fixture.scheduledAt, edition.sourceTimezone);
        const group = dates.get(date.key) ?? { key: date.key, label: date.label, fixtures: [] };
        group.fixtures.push(fixture);
        dates.set(date.key, group);
      }

      return {
        id: stage.id,
        slug: stage.slug,
        name: stage.name,
        type: stage.type,
        sequence: stage.sequence,
        fixtureCount: stage.fixtures.length,
        dates: [...dates.values()],
      };
    });

  return {
    editionId: edition.id,
    competitionName: edition.competitionName,
    editionLabel: edition.editionLabel,
    competitionKind: edition.competitionKind,
    sourceTimezone: edition.sourceTimezone,
    timezoneLabel: timezoneLabel(matches[0]?.scheduledAt, edition.sourceTimezone),
    summary: {
      fixtureCount: matches.length,
      teamCount: edition.teamCount,
      stageCount: stages.length,
      scheduledCount: matches.filter((match) => match.status === 'SCHEDULED').length,
      liveCount: matches.filter((match) => match.status === 'LIVE').length,
      completedCount: matches.filter((match) => match.status === 'COMPLETED').length,
      dateRangeLabel: dateRangeLabel(
        matches[0]?.scheduledAt,
        matches.at(-1)?.scheduledAt,
        edition.sourceTimezone,
      ),
    },
    stages,
  };
}

const loadScheduleRecords = (editionId: string) => prisma.match.findMany({
  where: {
    competitionId: editionId,
    isSimulation: false,
    stage: { is: { isPublished: true } },
  },
  select: editionScheduleMatchSelect,
  orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
});

const getScheduleRecords = process.env.NODE_ENV === 'test'
  ? loadScheduleRecords
  : unstable_cache(loadScheduleRecords, ['edition-schedule-v1'], {
      revalidate: 60,
      tags: ['edition-schedule'],
    });

export async function getEditionSchedule(
  edition: CompetitionOption,
): Promise<EditionSchedule> {
  if (!edition.series) {
    throw new Error(`Competition edition ${edition.id} has no series`);
  }

  const records = await getScheduleRecords(edition.id);
  return buildEditionSchedule({
    id: edition.id,
    competitionName: edition.series.name,
    editionLabel: edition.label ?? String(edition.season),
    competitionKind: edition.series.kind,
    sourceTimezone: edition.sourceTimezone,
    teamCount: edition._count.entries,
  }, records);
}
