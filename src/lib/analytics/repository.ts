import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { getVerifiedAnalyticsDatabase } from '@/lib/scoped-database-boundary';
import { timedConnection, timedQuery } from '@/lib/server-timing';
import type { AnalyticsCoverageState, AnalyticsEntityType } from '@/lib/analytics/types';

async function analyticsQuery<T>(
  name: string,
  query: (database: PrismaClient) => Promise<T>,
): Promise<T> {
  const database = await timedConnection(
    'analytics_database_connection',
    getVerifiedAnalyticsDatabase,
  );
  return timedQuery(name, () => query(database));
}

export interface AnalyticsEdition {
  id: string;
  season: number;
  name: string;
  slug: string;
  label: string | null;
  seasonStart: Date | null;
  seasonEnd: Date | null;
  sourceTimezone: string;
  series: {
    id: string;
    slug: string;
    name: string;
    kind: 'LEAGUE' | 'TOURNAMENT';
  };
}

interface AnalyticsEditionRow {
  competition_id: string;
  season: number;
  competition_name: string;
  competition_slug: string;
  competition_label: string | null;
  season_start: Date | null;
  season_end: Date | null;
  source_timezone: string;
  series_id: string;
  series_slug: string;
  series_name: string;
  competition_kind: 'LEAGUE' | 'TOURNAMENT';
}

export interface AnalyticsPlayerFactRow {
  match_id: string;
  competition_id: string;
  competition_series_id: string;
  competition_kind: 'LEAGUE' | 'TOURNAMENT';
  stage_id: string | null;
  stage_group_id: string | null;
  scheduled_at: Date;
  source_updated_at: Date | null;
  player_id: string;
  position: string;
  player_box_score_coverage: AnalyticsCoverageState;
  net_points_coverage: AnalyticsCoverageState;
  super_shots_coverage: AnalyticsCoverageState;
  minutes_played: number;
  goals: number;
  attempts: number;
  goal_assists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centre_pass_receives: number;
  turnovers: number;
  gains: number;
  pickups: number;
  net_points: number;
}

export interface AnalyticsTeamFactRow {
  match_id: string;
  competition_id: string;
  competition_series_id: string;
  competition_kind: 'LEAGUE' | 'TOURNAMENT';
  stage_id: string | null;
  stage_group_id: string | null;
  scheduled_at: Date;
  source_updated_at: Date | null;
  team_id: string;
  team_box_score_coverage: AnalyticsCoverageState;
  net_points_coverage: AnalyticsCoverageState;
  goals: number;
  attempts: number;
  goal_assists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  penalties: number;
  feeds: number;
  centre_pass_receives: number;
  turnovers: number;
  gains: number;
  pickups: number;
  net_points: number;
  goal_differential: number | null;
  turnover_differential: number | null;
  shooting_percentage_differential: number | null;
}

export interface AnalyticsPlayerDirectoryEntry {
  id: string;
  name: string;
  position: string;
  teamName: string;
}

export interface AnalyticsTeamDirectoryEntry {
  id: string;
  name: string;
  slug: string;
  abbreviation: string;
}

export async function listAnalyticsEditions(): Promise<AnalyticsEdition[]> {
  const rows = await analyticsQuery('analytics_competition_directory', (database) => database.$queryRaw<AnalyticsEditionRow[]>(Prisma.sql`
    SELECT
      competition_id, season, competition_name, competition_slug,
      competition_label, season_start, season_end, source_timezone,
      series_id, series_slug, series_name, competition_kind
    FROM analytics.competition_directory
    ORDER BY season DESC, season_start DESC NULLS LAST, competition_id DESC
  `));
  return rows.map((row) => ({
    id: row.competition_id,
    season: row.season,
    name: row.competition_name,
    slug: row.competition_slug,
    label: row.competition_label,
    seasonStart: row.season_start,
    seasonEnd: row.season_end,
    sourceTimezone: row.source_timezone,
    series: {
      id: row.series_id,
      slug: row.series_slug,
      name: row.series_name,
      kind: row.competition_kind,
    },
  }));
}

export async function readAnalyticsPlayerFacts(
  competitionIds: readonly string[],
): Promise<AnalyticsPlayerFactRow[]> {
  if (competitionIds.length === 0) return [];
  return analyticsQuery('analytics_player_facts', (database) => database.$queryRaw<AnalyticsPlayerFactRow[]>(Prisma.sql`
    SELECT
      match_id, competition_id, competition_series_id, competition_kind,
      stage_id, stage_group_id, scheduled_at, source_updated_at,
      player_id, position, player_box_score_coverage, net_points_coverage,
      super_shots_coverage, minutes_played, goals, attempts, goal_assists,
      intercepts, deflections, rebounds, penalties, feeds,
      centre_pass_receives, turnovers, gains, pickups, net_points
    FROM analytics.player_match_read
    WHERE competition_id IN (${Prisma.join(competitionIds)})
  `));
}

export async function readAnalyticsTeamFacts(
  competitionIds: readonly string[],
): Promise<AnalyticsTeamFactRow[]> {
  if (competitionIds.length === 0) return [];
  return analyticsQuery('analytics_team_facts', (database) => database.$queryRaw<AnalyticsTeamFactRow[]>(Prisma.sql`
    SELECT
      match_id, competition_id, competition_series_id, competition_kind,
      stage_id, stage_group_id, scheduled_at, source_updated_at,
      team_id, team_box_score_coverage, net_points_coverage,
      goals, attempts, goal_assists, intercepts, deflections, rebounds,
      penalties, feeds, centre_pass_receives, turnovers, gains, pickups,
      net_points, goal_differential, turnover_differential,
      shooting_percentage_differential
    FROM analytics.team_match_read
    WHERE competition_id IN (${Prisma.join(competitionIds)})
  `));
}

export async function readAnalyticsPlayers(
  playerIds: readonly string[],
  competitionId?: string,
): Promise<AnalyticsPlayerDirectoryEntry[]> {
  if (playerIds.length === 0) return [];
  type PlayerRow = {
    player_id: string;
    player_name: string;
    position: string;
    team_name: string;
  };
  const rows = await analyticsQuery('analytics_player_directory', (database) => competitionId
    ? database.$queryRaw<PlayerRow[]>(Prisma.sql`
        SELECT player_id, player_name, position, team_name
        FROM analytics.player_edition_directory
        WHERE competition_id = ${competitionId}
          AND player_id IN (${Prisma.join(playerIds)})
      `)
    : database.$queryRaw<PlayerRow[]>(Prisma.sql`
        SELECT player_id, player_name, position, team_name
        FROM analytics.player_directory
        WHERE player_id IN (${Prisma.join(playerIds)})
      `));
  return rows.map((row) => ({ id: row.player_id, name: row.player_name, position: row.position, teamName: row.team_name }));
}

export async function readAnalyticsTeams(
  teamIds: readonly string[],
): Promise<AnalyticsTeamDirectoryEntry[]> {
  if (teamIds.length === 0) return [];
  const rows = await analyticsQuery('analytics_team_directory', (database) => database.$queryRaw<Array<{
    team_id: string;
    team_name: string;
    team_slug: string;
    team_abbreviation: string;
  }>>(Prisma.sql`
    SELECT team_id, team_name, team_slug, team_abbreviation
    FROM analytics.team_directory
    WHERE team_id IN (${Prisma.join(teamIds)})
  `));
  return rows.map((row) => ({
    id: row.team_id,
    name: row.team_name,
    slug: row.team_slug,
    abbreviation: row.team_abbreviation,
  }));
}

export async function readComparisonPlayers(
  competitionId: string,
): Promise<AnalyticsPlayerDirectoryEntry[]> {
  const rows = await analyticsQuery('analytics_comparison_players', (database) => database.$queryRaw<Array<{
    player_id: string;
    player_name: string;
    position: string;
    team_name: string;
  }>>(Prisma.sql`
    SELECT player_id, player_name, position, team_name
    FROM analytics.player_edition_directory edition_player
    WHERE competition_id = ${competitionId}
      AND EXISTS (
        SELECT 1
        FROM analytics.player_match_read fact
        WHERE fact.competition_id = edition_player.competition_id
          AND fact.player_id = edition_player.player_id
      )
    ORDER BY team_name, player_name, player_id
  `));
  return rows.map((row) => ({ id: row.player_id, name: row.player_name, position: row.position, teamName: row.team_name }));
}

export async function readFinalsStageIds(competitionId: string): Promise<string[]> {
  const rows = await analyticsQuery('analytics_finals_stages', (database) => database.$queryRaw<Array<{ stage_id: string }>>(Prisma.sql`
    SELECT stage_id
    FROM analytics.stage_directory
    WHERE competition_id = ${competitionId}
      AND stage_type IN ('FINALS', 'SEMI_FINALS', 'MEDAL_MATCHES')
    ORDER BY stage_id
  `));
  return rows.map((row) => row.stage_id);
}

export interface AnalyticsTeamPowerMatchRow {
  match_id: string;
  competition_id: string;
  competition_series_id: string;
  competition_kind: 'LEAGUE' | 'TOURNAMENT';
  scheduled_at: Date;
  source_updated_at: Date | null;
  neutral_venue: boolean;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
}

export async function readTeamPowerMatches(competitionId: string): Promise<AnalyticsTeamPowerMatchRow[]> {
  return analyticsQuery('analytics_team_power_matches', (database) => database.$queryRaw<AnalyticsTeamPowerMatchRow[]>(Prisma.sql`
    SELECT
      match_id, competition_id, competition_series_id, competition_kind,
      scheduled_at, source_updated_at, neutral_venue, home_team_id,
      away_team_id, home_score, away_score
    FROM analytics.team_power_match
    WHERE competition_id = ${competitionId}
    ORDER BY scheduled_at, match_id
  `));
}

export async function readEditionTeams(competitionId: string): Promise<AnalyticsTeamDirectoryEntry[]> {
  const rows = await analyticsQuery('analytics_edition_teams', (database) => database.$queryRaw<Array<{
    team_id: string;
    team_name: string;
    team_slug: string;
    team_abbreviation: string;
  }>>(Prisma.sql`
    SELECT team_id, team_name, team_slug, team_abbreviation
    FROM analytics.team_edition_directory
    WHERE competition_id = ${competitionId}
    ORDER BY team_name, team_id
  `));
  return rows.map((row) => ({
    id: row.team_id,
    name: row.team_name,
    slug: row.team_slug,
    abbreviation: row.team_abbreviation,
  }));
}

export async function readPlayerName(playerId: string): Promise<string | null> {
  const rows = await (await getVerifiedAnalyticsDatabase()).$queryRaw<Array<{ player_name: string }>>(Prisma.sql`
    SELECT player_name
    FROM analytics.player_directory
    WHERE player_id = ${playerId}
    LIMIT 1
  `);
  return rows[0]?.player_name ?? null;
}

export async function readOpponentMatchIds(
  competitionId: string,
  opponentTeamId: string,
): Promise<string[]> {
  const rows = await (await getVerifiedAnalyticsDatabase()).$queryRaw<Array<{ match_id: string }>>(Prisma.sql`
    SELECT match_id
    FROM analytics.opponent_match_directory
    WHERE competition_id = ${competitionId}
      AND team_id = ${opponentTeamId}
    ORDER BY match_id
  `);
  return rows.map((row) => row.match_id);
}

export async function readAnalyticsRevision(): Promise<{ revision: bigint; invalidatedAt: Date | null }> {
  const rows = await (await getVerifiedAnalyticsDatabase()).$queryRaw<Array<{ revision: bigint; invalidated_at: Date | null }>>(Prisma.sql`
    SELECT revision, invalidated_at
    FROM analytics.cache_revision_read
  `);
  return { revision: rows[0]?.revision ?? BigInt(0), invalidatedAt: rows[0]?.invalidated_at ?? null };
}

export interface ParserDirectoryRows {
  players: Array<{ id: string; name: string; position: string; aliases: string[] }>;
  teams: Array<{ id: string; name: string; abbreviation: string; aliases: string[] }>;
  stages: Array<{ id: string; competitionId: string; name: string; slug: string; type: string }>;
  groups: Array<{ id: string; competitionId: string; name: string; slug: string }>;
}

export async function readParserDirectory(): Promise<ParserDirectoryRows> {
  const database = await getVerifiedAnalyticsDatabase();
  const [players, playerAliases, teams, teamAliases, stages, groups] = await Promise.all([
    database.$queryRaw<Array<{ player_id: string; player_name: string; position: string }>>(Prisma.sql`
      SELECT player_id, player_name, position FROM analytics.player_directory ORDER BY player_name, player_id
    `),
    database.$queryRaw<Array<{ player_id: string; alias: string }>>(Prisma.sql`
      SELECT player_id, alias FROM analytics.player_alias_directory ORDER BY player_id, alias
    `),
    database.$queryRaw<Array<{ team_id: string; team_name: string; team_abbreviation: string }>>(Prisma.sql`
      SELECT team_id, team_name, team_abbreviation FROM analytics.team_directory ORDER BY team_name, team_id
    `),
    database.$queryRaw<Array<{ team_id: string; alias: string }>>(Prisma.sql`
      SELECT team_id, alias FROM analytics.team_alias_directory ORDER BY team_id, alias
    `),
    database.$queryRaw<Array<{ stage_id: string; competition_id: string; stage_name: string; stage_slug: string; stage_type: string }>>(Prisma.sql`
      SELECT stage_id, competition_id, stage_name, stage_slug, stage_type
      FROM analytics.stage_directory ORDER BY competition_id, stage_id
    `),
    database.$queryRaw<Array<{ stage_group_id: string; competition_id: string; stage_group_name: string; stage_group_slug: string }>>(Prisma.sql`
      SELECT stage_group_id, competition_id, stage_group_name, stage_group_slug
      FROM analytics.stage_group_directory ORDER BY competition_id, stage_group_id
    `),
  ]);
  const playerAliasMap = new Map<string, string[]>();
  for (const alias of playerAliases) playerAliasMap.set(alias.player_id, [...(playerAliasMap.get(alias.player_id) ?? []), alias.alias]);
  const teamAliasMap = new Map<string, string[]>();
  for (const alias of teamAliases) teamAliasMap.set(alias.team_id, [...(teamAliasMap.get(alias.team_id) ?? []), alias.alias]);
  return {
    players: players.map((player) => ({
      id: player.player_id,
      name: player.player_name,
      position: player.position,
      aliases: playerAliasMap.get(player.player_id) ?? [],
    })),
    teams: teams.map((team) => ({
      id: team.team_id,
      name: team.team_name,
      abbreviation: team.team_abbreviation,
      aliases: teamAliasMap.get(team.team_id) ?? [],
    })),
    stages: stages.map((stage) => ({
      id: stage.stage_id,
      competitionId: stage.competition_id,
      name: stage.stage_name,
      slug: stage.stage_slug,
      type: stage.stage_type,
    })),
    groups: groups.map((group) => ({
      id: group.stage_group_id,
      competitionId: group.competition_id,
      name: group.stage_group_name,
      slug: group.stage_group_slug,
    })),
  };
}

export type AnalyticsDirectoryEntity = AnalyticsPlayerDirectoryEntry | AnalyticsTeamDirectoryEntry;

export async function readAnalyticsEntities(
  entityType: AnalyticsEntityType,
  ids: readonly string[],
  competitionId?: string,
): Promise<AnalyticsDirectoryEntity[]> {
  return entityType === 'PLAYER' ? readAnalyticsPlayers(ids, competitionId) : readAnalyticsTeams(ids);
}
