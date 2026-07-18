export interface ProjectableTeam {
  id: string;
  name: string;
  abbreviation?: string | null;
  slug?: string | null;
  logoUrl?: string | null;
}

export interface ProjectableSlot {
  side: 'A' | 'B';
  sourceLabel?: string | null;
  resolvedEntry?: {
    displayName?: string | null;
    team: ProjectableTeam;
  } | null;
}

export interface MatchSideProjection {
  side: 'A' | 'B';
  role: 'Home' | 'Away' | 'Team A' | 'Team B';
  team: ProjectableTeam | null;
  displayName: string;
  resolved: boolean;
}

export interface MatchProjectionInput {
  neutralVenue: boolean;
  homeTeam?: ProjectableTeam | null;
  awayTeam?: ProjectableTeam | null;
  slots?: readonly ProjectableSlot[];
}

interface MatchTeamIdentity {
  homeTeamId: string | null;
  awayTeamId: string | null;
}

interface LegacyMatchIdentity extends MatchTeamIdentity {
  round: number | null;
}

type ResolvedRelation<T, K extends PropertyKey> = K extends keyof T
  ? { [P in K]-?: NonNullable<T[P]> }
  : unknown;

export type ResolvedMatchTeams<T extends MatchTeamIdentity> = T & {
  homeTeamId: string;
  awayTeamId: string;
} & ResolvedRelation<T, 'homeTeam'> & ResolvedRelation<T, 'awayTeam'>;

export type ResolvedLegacyMatch<T extends LegacyMatchIdentity> = ResolvedMatchTeams<T> & {
  round: number;
};

/**
 * Public match surfaces only require both teams to be resolved. Tournament
 * fixtures can intentionally have no numerical round and use roundLabel/stage.
 */
export function hasResolvedMatchTeams<T extends MatchTeamIdentity>(
  match: T,
): match is ResolvedMatchTeams<T> {
  const relations = match as T & {
    homeTeam?: unknown | null;
    awayTeam?: unknown | null;
  };

  return match.homeTeamId !== null
    && match.awayTeamId !== null
    && (!('homeTeam' in relations) || relations.homeTeam != null)
    && (!('awayTeam' in relations) || relations.awayTeam != null);
}

/**
 * Legacy ingestion paths use this where a numerical round is still required.
 */
export function hasResolvedLegacyMatch<T extends LegacyMatchIdentity>(
  match: T
): match is ResolvedLegacyMatch<T> {
  return hasResolvedMatchTeams(match) && match.round !== null;
}

function slotFor(input: MatchProjectionInput, side: 'A' | 'B'): ProjectableSlot | undefined {
  return input.slots?.find((slot) => slot.side === side);
}

function projectSide(
  input: MatchProjectionInput,
  side: 'A' | 'B'
): MatchSideProjection {
  const slot = slotFor(input, side);
  const legacyTeam = side === 'A' ? input.homeTeam : input.awayTeam;
  const team = slot?.resolvedEntry?.team ?? legacyTeam ?? null;
  const useHomeAway = !input.neutralVenue && Boolean(input.homeTeam && input.awayTeam);

  return {
    side,
    role: useHomeAway ? (side === 'A' ? 'Home' : 'Away') : `Team ${side}`,
    team,
    displayName: slot?.resolvedEntry?.displayName ?? team?.name ?? slot?.sourceLabel ?? 'TBC',
    resolved: team !== null,
  };
}

export function projectMatchSides(input: MatchProjectionInput): {
  sideA: MatchSideProjection;
  sideB: MatchSideProjection;
  hasHomeAdvantage: boolean;
} {
  const sideA = projectSide(input, 'A');
  const sideB = projectSide(input, 'B');

  return {
    sideA,
    sideB,
    hasHomeAdvantage:
      !input.neutralVenue
      && sideA.resolved
      && sideB.resolved
      && sideA.role === 'Home',
  };
}
