import {
  TEAM_POWER_METHOD_VERSION,
  type RankingEntity,
  type TeamPowerMatch,
  type TeamPowerSnapshot,
} from '@/lib/rankings/types';

export const TEAM_POWER_METHODOLOGY = {
  version: TEAM_POWER_METHOD_VERSION,
  startingRating: 1500,
  leagueKFactor: 24,
  tournamentKFactor: 28,
  leagueHomeAdvantage: 35,
  tournamentHomeAdvantage: 0,
  marginCap: 1.75,
  description: 'Chronological Elo-style rating. League matches receive a 35-point home adjustment unless the venue is neutral; tournament matches receive no home adjustment. Winning margin has a logarithmic multiplier capped at 1.75.',
} as const;

interface TeamState {
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  matchIds: string[];
}

function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + (10 ** ((opponentRating - rating) / 400)));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function scopeKey(competitionId: string, kind: string | null): string {
  return `edition:${competitionId}|kind:${kind ?? 'UNKNOWN'}|method:${TEAM_POWER_METHOD_VERSION}`;
}

export function calculateTeamPowerSnapshot(
  competitionId: string,
  matches: readonly TeamPowerMatch[],
  entities: readonly RankingEntity[],
): TeamPowerSnapshot {
  const selected = matches
    .filter((match) => match.competitionId === competitionId)
    .toSorted((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime() || left.id.localeCompare(right.id));
  const kinds = new Set(selected.map((match) => match.competitionKind));
  const series = new Set(selected.map((match) => match.competitionSeriesId));
  if (kinds.size > 1 || series.size > 1) {
    throw new Error('Team power snapshots cannot mix competition types or series');
  }

  const states = new Map<string, TeamState>();
  const stateFor = (teamId: string): TeamState => {
    const state = states.get(teamId) ?? {
      rating: TEAM_POWER_METHODOLOGY.startingRating,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      matchIds: [],
    };
    states.set(teamId, state);
    return state;
  };

  for (const match of selected) {
    if (match.homeTeamId === match.awayTeamId) throw new Error(`Match ${match.id} has the same team on both sides`);
    const home = stateFor(match.homeTeamId);
    const away = stateFor(match.awayTeamId);
    const homeAdvantage = match.neutralVenue
      ? 0
      : match.competitionKind === 'LEAGUE'
        ? TEAM_POWER_METHODOLOGY.leagueHomeAdvantage
        : TEAM_POWER_METHODOLOGY.tournamentHomeAdvantage;
    const expectedHome = expectedScore(home.rating + homeAdvantage, away.rating);
    const actualHome = match.homeScore === match.awayScore ? 0.5 : match.homeScore > match.awayScore ? 1 : 0;
    const margin = Math.abs(match.homeScore - match.awayScore);
    const marginMultiplier = Math.min(
      TEAM_POWER_METHODOLOGY.marginCap,
      1 + (Math.log1p(margin) / 5),
    );
    const kFactor = match.competitionKind === 'TOURNAMENT'
      ? TEAM_POWER_METHODOLOGY.tournamentKFactor
      : TEAM_POWER_METHODOLOGY.leagueKFactor;
    const delta = kFactor * marginMultiplier * (actualHome - expectedHome);
    home.rating += delta;
    away.rating -= delta;
    home.games += 1;
    away.games += 1;
    home.matchIds.push(match.id);
    away.matchIds.push(match.id);
    if (actualHome === 1) {
      home.wins += 1;
      away.losses += 1;
    } else if (actualHome === 0) {
      away.wins += 1;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
    }
  }

  const ranked = entities
    .flatMap((entity) => {
      const state = states.get(entity.id);
      return state && state.games > 0 ? [{ entity, state }] : [];
    })
    .toSorted((left, right) => right.state.rating - left.state.rating || left.entity.name.localeCompare(right.entity.name));
  const populationSize = ranked.length;
  const kind = selected[0]?.competitionKind ?? null;
  const competitionSeriesId = selected[0]?.competitionSeriesId ?? null;
  const asOfDate = selected.reduce<Date | null>((latest, match) => {
    const candidate = match.sourceUpdatedAt ?? match.scheduledAt;
    return !latest || candidate > latest ? candidate : latest;
  }, null);

  return {
    rankingType: 'TEAM_POWER',
    methodVersion: TEAM_POWER_METHOD_VERSION,
    formulaVersion: TEAM_POWER_METHOD_VERSION,
    competitionId,
    competitionSeriesId,
    competitionKind: kind,
    scopeKey: scopeKey(competitionId, kind),
    asOf: asOfDate?.toISOString() ?? null,
    populationSize,
    entries: ranked.map(({ entity, state }, index) => ({
      rank: index + 1,
      percentile: populationSize === 0 ? 0 : Math.round((((populationSize - index) - 0.5) / populationSize) * 10_000) / 100,
      entity,
      rating: round(state.rating),
      games: state.games,
      wins: state.wins,
      draws: state.draws,
      losses: state.losses,
      coverage: 'AVAILABLE',
      includedMatchIds: state.matchIds,
      movement: null,
      movementLabel: 'NEW',
    })),
  };
}

