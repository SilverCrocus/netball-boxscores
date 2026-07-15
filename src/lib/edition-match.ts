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
