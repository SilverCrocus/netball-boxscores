import type { StageType } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { CompetitionOption } from '@/lib/competitions';
import { formatMatchStage } from '@/lib/match-label';
import {
  canExposePublicMatchScore,
  resolvePublicMatchAccessBatch,
} from '@/lib/public-match';
import type {
  TournamentBracketMatch,
  TournamentBracketSide,
  TournamentBracketStage,
  TournamentPool,
  TournamentPoolOverview,
  TournamentPoolStandings,
  TournamentStandingRow,
  TournamentStandingsOverview,
  TournamentTeam,
} from '@/lib/tournament/types';

const BRACKET_STAGE_TYPES: StageType[] = [
  'CLASSIFICATION',
  'SEMI_FINALS',
  'MEDAL_MATCHES',
];

const TEAM_SELECT = {
  id: true,
  name: true,
  slug: true,
  abbreviation: true,
  logoUrl: true,
} as const;

function entryName(entry: {
  displayName: string | null;
  team: { name: string };
}): string {
  return entry.displayName?.trim() || entry.team.name;
}

function displaySourceLabel(label: string | null | undefined): string | null {
  const value = label?.trim();
  return value ? value.replace(/\bTBC\b/gi, 'to be confirmed') : null;
}
function compareTeams(left: TournamentTeam, right: TournamentTeam): number {
  const leftSeed = left.seed ?? Number.MAX_SAFE_INTEGER;
  const rightSeed = right.seed ?? Number.MAX_SAFE_INTEGER;
  return leftSeed - rightSeed || left.displayName.localeCompare(right.displayName);
}

function projectEntry(entry: {
  id: string;
  seed: number | null;
  displayName: string | null;
  team: {
    id: string;
    name: string;
    slug: string;
    abbreviation: string;
    logoUrl: string | null;
  };
}): TournamentTeam {
  return {
    entryId: entry.id,
    teamId: entry.team.id,
    name: entry.team.name,
    displayName: entryName(entry),
    slug: entry.team.slug,
    abbreviation: entry.team.abbreviation,
    logoUrl: entry.team.logoUrl,
    seed: entry.seed,
  };
}

export async function getTournamentPools(
  competitionId: string,
): Promise<TournamentPoolOverview | null> {
  const poolStage = await prisma.stage.findFirst({
    where: {
      competitionId,
      type: 'POOL',
      isPublished: true,
    },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      name: true,
      groups: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          slug: true,
          name: true,
          sequence: true,
          primaryEntries: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              seed: true,
              displayName: true,
              team: { select: TEAM_SELECT },
            },
          },
        },
      },
    },
  });

  if (!poolStage) return null;

  const pools: TournamentPool[] = poolStage.groups.map((group) => ({
    id: group.id,
    slug: group.slug,
    name: group.name,
    sequence: group.sequence,
    teams: group.primaryEntries.map(projectEntry).sort(compareTeams),
  }));

  return {
    stageId: poolStage.id,
    stageName: poolStage.name,
    participantCount: pools.reduce((total, pool) => total + pool.teams.length, 0),
    pools,
  };
}

export async function getTournamentPoolStandings(
  competitionId: string,
): Promise<TournamentStandingsOverview | null> {
  const poolStage = await prisma.stage.findFirst({
    where: {
      competitionId,
      type: 'POOL',
      isPublished: true,
    },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      name: true,
      groups: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          slug: true,
          name: true,
          sequence: true,
          primaryEntries: {
            where: { status: 'ACTIVE' },
            select: {
              id: true,
              seed: true,
              displayName: true,
              team: { select: TEAM_SELECT },
            },
          },
          standings: {
            orderBy: { rank: 'asc' },
            select: {
              id: true,
              editionEntryId: true,
              rank: true,
              played: true,
              wins: true,
              losses: true,
              draws: true,
              goalsFor: true,
              goalsAgainst: true,
              goalPercentage: true,
              points: true,
            },
          },
        },
      },
    },
  });

  if (!poolStage) return null;

  const pools: TournamentPoolStandings[] = poolStage.groups.map((group) => {
    const standingsByEntry = new Map(
      group.standings.map((standing) => [standing.editionEntryId, standing]),
    );

    const rows: TournamentStandingRow[] = group.primaryEntries.map((entry) => {
      const standing = standingsByEntry.get(entry.id);
      return {
        ...projectEntry(entry),
        standing: standing
          ? {
              id: standing.id,
              rank: standing.rank,
              played: standing.played,
              wins: standing.wins,
              losses: standing.losses,
              draws: standing.draws,
              goalsFor: standing.goalsFor,
              goalsAgainst: standing.goalsAgainst,
              goalPercentage: standing.goalPercentage,
              points: standing.points,
            }
          : null,
      };
    });

    rows.sort((left, right) => {
      if (left.standing && right.standing) {
        return left.standing.rank - right.standing.rank;
      }
      if (left.standing) return -1;
      if (right.standing) return 1;
      return compareTeams(left, right);
    });

    return {
      id: group.id,
      slug: group.slug,
      name: group.name,
      sequence: group.sequence,
      hasStandings: group.standings.length > 0,
      rows,
    };
  });

  return {
    stageId: poolStage.id,
    stageName: poolStage.name,
    hasAnyStandings: pools.some((pool) => pool.hasStandings),
    pools,
  };
}

interface BracketTeamInput {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

interface BracketSlotInput {
  side: 'A' | 'B';
  sourceLabel: string | null;
  resolvedEntry: {
    displayName: string | null;
    team: BracketTeamInput;
  } | null;
}

interface BracketMatchInput {
  id: string;
  round: number | null;
  roundLabel: string | null;
  finalCode: string | null;
  scheduledAt: Date;
  venue: string;
  status: string;
  scoreAvailable: boolean;
  homeScore: number;
  awayScore: number;
  homeTeam: BracketTeamInput | null;
  awayTeam: BracketTeamInput | null;
  slots: BracketSlotInput[];
}

function projectBracketSide(
  match: BracketMatchInput,
  side: 'A' | 'B',
): TournamentBracketSide {
  const slot = match.slots.find((candidate) => candidate.side === side);
  const legacyTeam = side === 'A' ? match.homeTeam : match.awayTeam;
  const team = slot?.resolvedEntry?.team ?? legacyTeam;
  const resolvedDisplayName = slot?.resolvedEntry?.displayName?.trim();
  const sourceLabel = displaySourceLabel(slot?.sourceLabel);

  return {
    side,
    label: resolvedDisplayName || team?.name || sourceLabel || 'Qualification pending',
    resolved: Boolean(team),
    team: team
      ? {
          id: team.id,
          name: team.name,
          abbreviation: team.abbreviation,
          logoUrl: team.logoUrl,
        }
      : null,
    score: match.scoreAvailable
      ? (side === 'A' ? match.homeScore : match.awayScore)
      : null,
  };
}

export function projectBracketMatch(
  match: BracketMatchInput,
  stageName: string,
): TournamentBracketMatch {
  return {
    id: match.id,
    label: formatMatchStage(match.round, match.finalCode, match.roundLabel, stageName),
    scheduledAt: match.scheduledAt.toISOString(),
    venue: match.venue,
    status: match.status,
    sideA: projectBracketSide(match, 'A'),
    sideB: projectBracketSide(match, 'B'),
  };
}

export async function getTournamentBracket(
  competitionId: string,
  loadedEdition?: CompetitionOption,
): Promise<TournamentBracketStage[]> {
  const stages = await prisma.stage.findMany({
    where: {
      competitionId,
      type: { in: BRACKET_STAGE_TYPES },
      isPublished: true,
    },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      sequence: true,
      matches: {
        orderBy: { scheduledAt: 'asc' },
        select: {
          id: true,
          round: true,
          roundLabel: true,
          finalCode: true,
          scheduledAt: true,
          venue: true,
          status: true,
          homeScore: true,
          awayScore: true,
          homeTeam: { select: TEAM_SELECT },
          awayTeam: { select: TEAM_SELECT },
          slots: {
            orderBy: { side: 'asc' },
            select: {
              side: true,
              sourceLabel: true,
              resolvedEntry: {
                select: {
                  displayName: true,
                  team: { select: TEAM_SELECT },
                },
              },
            },
          },
        },
      },
    },
  });

  const matchIds = stages.flatMap((stage) => stage.matches.map((match) => match.id));
  const accessByMatchId = await resolvePublicMatchAccessBatch(
    matchIds,
    loadedEdition?.id === competitionId ? [loadedEdition] : undefined,
  );

  return stages.map((stage) => {
    const publicMatches = stage.matches.flatMap((match) => {
      const access = accessByMatchId.get(match.id);
      if (!access) return [];

      return [projectBracketMatch({
        ...match,
        scoreAvailable: canExposePublicMatchScore(access),
      }, stage.name)];
    });

    return {
      id: stage.id,
      slug: stage.slug,
      name: stage.name,
      type: stage.type as TournamentBracketStage['type'],
      sequence: stage.sequence,
      matches: publicMatches,
    };
  });
}
