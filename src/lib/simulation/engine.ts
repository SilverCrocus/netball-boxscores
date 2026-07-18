import { prisma } from '@/lib/db';
import type {
  SimState,
  SimMatch,
  SimMatchState,
  SimConfig,
  SimPlayer,
  SimPlayerStats,
} from './types';
import { STATE_ORDER, isActiveState, isBreakState, stateToPeriod } from './types';
import { emptyStats } from '@/lib/stat-utils';
import { assertSimulationDatabaseIsSafe } from './safety';

// ───── State management ─────

export function createSimState(config: SimConfig): SimState {
  return {
    running: false,
    paused: false,
    config,
    matches: [],
    log: [],
  };
}

export function advanceState(current: SimMatchState): SimMatchState {
  const idx = STATE_ORDER.indexOf(current);
  if (idx === -1 || idx >= STATE_ORDER.length - 1) return current;
  return STATE_ORDER[idx + 1];
}

// ───── Scoring ─────

export function generateGoals(): number {
  const rand = Math.random();
  if (rand < 0.50) return 0;
  if (rand < 0.90) return 1;
  return 2;
}

function isSuperShot(state: SimMatchState): boolean {
  return state === 'q4-active' && Math.random() < 0.15;
}

function generatePlayerStatsForTick(
  match: SimMatch,
  homeGoals: number,
  awayGoals: number,
): SimPlayerStats[] {
  const stats = [...match.playerStats];

  // Distribute goals to shooters
  const distributeGoals = (players: SimPlayer[], goals: number) => {
    const shooters = players.filter((p) => p.position === 'GS' || p.position === 'GA');
    if (shooters.length === 0 || goals === 0) return;

    for (let i = 0; i < goals; i++) {
      const shooter = shooters[Math.floor(Math.random() * shooters.length)];
      const stat = stats.find(
        (s) => s.playerId === shooter.championDataPlayerId,
      );
      if (stat) {
        stat.goals += 1;
        stat.attempts += 1;
        // Sometimes miss too (to get 70-85% accuracy)
        if (Math.random() < 0.2) stat.attempts += 1;
      }
    }

    // Distribute assists to midcourt
    const feeders = players.filter((p) =>
      ['WA', 'C', 'GA'].includes(p.position),
    );
    for (const feeder of feeders) {
      const stat = stats.find(
        (s) => s.playerId === feeder.championDataPlayerId,
      );
      if (stat && goals > 0) {
        stat.feeds += Math.ceil(goals * 0.7);
        stat.goalAssists += Math.floor(goals * 0.5);
        stat.centrePassReceives += Math.random() < 0.4 ? 1 : 0;
      }
    }

    // Distribute defensive stats
    const defenders = players.filter((p) =>
      ['GD', 'GK', 'WD'].includes(p.position),
    );
    for (const def of defenders) {
      const stat = stats.find(
        (s) => s.playerId === def.championDataPlayerId,
      );
      if (stat) {
        stat.intercepts += Math.random() < 0.3 ? 1 : 0;
        stat.deflections += Math.random() < 0.25 ? 1 : 0;
        stat.rebounds += Math.random() < 0.15 ? 1 : 0;
      }
    }

    // Small chance of turnovers and penalties for all
    for (const player of players) {
      const stat = stats.find(
        (s) => s.playerId === player.championDataPlayerId,
      );
      if (stat) {
        stat.turnovers += Math.random() < 0.1 ? 1 : 0;
        stat.penalties += Math.random() < 0.05 ? 1 : 0;
        stat.minutesPlayed += 0.5; // half a minute per tick
      }
    }
  };

  distributeGoals(match.homePlayers, homeGoals);
  distributeGoals(match.awayPlayers, awayGoals);

  return stats;
}

// ───── Tick logic ─────

/** Track break ticks per match (not serialized — lives in engine memory) */
const breakTickCounts = new Map<number, number>();

/** Reset break tick counters (for testing) */
export function resetBreakTicks(): void {
  breakTickCounts.clear();
}

export function tickMatch(match: SimMatch, tickStep: number): SimMatch {
  const updated = { ...match, tickCount: match.tickCount + 1 };

  // Respect start offset
  if (updated.state === 'pre-match') {
    if (updated.tickCount >= updated.startOffset) {
      updated.state = 'q1-active';
      updated.period = 1;
      updated.periodSeconds = 0;
    }
    return updated;
  }

  // Match complete — no changes
  if (updated.state === 'match-complete') {
    return updated;
  }

  // Break state — count break ticks, advance after 2
  if (isBreakState(updated.state)) {
    const key = updated.championDataMatchId;
    const count = (breakTickCounts.get(key) ?? 0) + 1;
    breakTickCounts.set(key, count);

    if (count >= 2) {
      breakTickCounts.delete(key);
      updated.state = advanceState(updated.state);
      updated.period = stateToPeriod(updated.state);
      updated.periodSeconds = 0;
    }
    return updated;
  }

  // Active state — advance time, maybe score
  if (isActiveState(updated.state)) {
    updated.periodSeconds = Math.min(updated.periodSeconds + tickStep, 900);

    // Generate scoring
    const homeGoals = generateGoals();
    const awayGoals = generateGoals();

    for (let i = 0; i < homeGoals; i++) {
      const points = isSuperShot(updated.state) ? 2 : 1;
      updated.homeScore += points;
      updated.scoreFlow = [
        ...updated.scoreFlow,
        {
          period: updated.period,
          periodSeconds: updated.periodSeconds,
          squadId: updated.homeSquadId,
          scorepoints: points,
          homeScore: updated.homeScore,
          awayScore: updated.awayScore,
        },
      ];
    }

    for (let i = 0; i < awayGoals; i++) {
      const points = isSuperShot(updated.state) ? 2 : 1;
      updated.awayScore += points;
      updated.scoreFlow = [
        ...updated.scoreFlow,
        {
          period: updated.period,
          periodSeconds: updated.periodSeconds,
          squadId: updated.awaySquadId,
          scorepoints: points,
          homeScore: updated.homeScore,
          awayScore: updated.awayScore,
        },
      ];
    }

    // Update player stats
    updated.playerStats = generatePlayerStatsForTick(updated, homeGoals, awayGoals);

    // Transition if quarter over
    if (updated.periodSeconds >= 900) {
      updated.state = advanceState(updated.state);
      if (isBreakState(updated.state)) {
        breakTickCounts.set(updated.championDataMatchId, 0);
      }
    }
  }

  return updated;
}

// ───── Database setup/teardown ─────

export async function cleanupOrphanedSimData(): Promise<number> {
  assertSimulationDatabaseIsSafe();

  const orphaned = await prisma.match.findMany({
    where: { isSimulation: true },
    select: { id: true },
  });
  if (orphaned.length === 0) return 0;

  const matchIds = orphaned.map((m) => m.id);
  await prisma.scoreFlow.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.playerMatchStats.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.matchQuarter.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.userFavorite.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.userReminder.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  return orphaned.length;
}

export async function setupSimMatches(
  matchCount: number,
): Promise<SimMatch[]> {
  assertSimulationDatabaseIsSafe();

  const competition = await prisma.competition.findFirst();
  if (!competition) throw new Error('No competition found in DB');

  const teams = await prisma.team.findMany({
    where: { championDataTeamId: { not: null } },
    include: {
      players: {
        where: { championDataPlayerId: { not: null } },
        select: {
          championDataPlayerId: true,
          name: true,
          position: true,
          teamId: true,
        },
      },
    },
  });

  if (teams.length < 2) throw new Error('Need at least 2 teams in DB');

  // Shuffle teams and pair them
  const shuffled = [...teams].sort(() => Math.random() - 0.5);
  const venues = [
    'John Cain Arena',
    'Ken Rosewall Arena',
    'RAC Arena',
    'Adelaide Entertainment Centre',
  ];

  const matches: SimMatch[] = [];

  for (let i = 0; i < matchCount && i * 2 + 1 < shuffled.length; i++) {
    const home = shuffled[i * 2];
    const away = shuffled[i * 2 + 1];

    const cdMatchId = 99001 + i;

    // Create temp Match record in DB
    const dbMatch = await prisma.match.create({
      data: {
        competitionId: competition.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        round: 99,
        isSimulation: true,
        venue: venues[i % venues.length],
        scheduledAt: new Date(),
        status: 'SCHEDULED',
        homeScore: 0,
        awayScore: 0,
        championDataMatchId: cdMatchId,
      },
    });

    const homePlayers: SimPlayer[] = home.players.slice(0, 7).map((p) => ({
      championDataPlayerId: p.championDataPlayerId!,
      name: p.name,
      position: p.position,
      squadId: home.championDataTeamId!,
    }));

    const awayPlayers: SimPlayer[] = away.players.slice(0, 7).map((p) => ({
      championDataPlayerId: p.championDataPlayerId!,
      name: p.name,
      position: p.position,
      squadId: away.championDataTeamId!,
    }));

    // Initialize player stats
    const initStats = (players: SimPlayer[]): SimPlayerStats[] =>
      players.map((p) => ({
        playerId: p.championDataPlayerId,
        displayName: p.name,
        position: p.position,
        squadId: p.squadId,
        ...emptyStats(),
      }));

    matches.push({
      matchIndex: i,
      championDataMatchId: cdMatchId,
      prismaMatchId: dbMatch.id,
      state: 'pre-match',
      homeSquadId: home.championDataTeamId!,
      homeSquadName: home.name,
      homeSquadCode: home.abbreviation,
      awaySquadId: away.championDataTeamId!,
      awaySquadName: away.name,
      awaySquadCode: away.abbreviation,
      homeScore: 0,
      awayScore: 0,
      period: 0,
      periodSeconds: 0,
      tickCount: 0,
      scoreFlow: [],
      playerStats: [...initStats(homePlayers), ...initStats(awayPlayers)],
      homePlayers,
      awayPlayers,
      venue: venues[i % venues.length],
      startOffset: i * 5, // stagger by 5 ticks
    });
  }

  return matches;
}

export async function teardownSimMatches(matches: SimMatch[]): Promise<void> {
  assertSimulationDatabaseIsSafe();

  for (const match of matches) {
    // Delete associated records first (no cascade by default)
    await prisma.scoreFlow.deleteMany({
      where: { matchId: match.prismaMatchId },
    });
    await prisma.playerMatchStats.deleteMany({
      where: { matchId: match.prismaMatchId },
    });
    await prisma.matchQuarter.deleteMany({
      where: { matchId: match.prismaMatchId },
    });
    await prisma.match.delete({
      where: { id: match.prismaMatchId },
    });
  }
}

// ───── Tick all matches ─────

export function tickAllMatches(state: SimState): SimState {
  const updated = { ...state };
  updated.matches = state.matches.map((m) => {
    const ticked = tickMatch(m, state.config.tickStep);
    // Log state transitions
    if (ticked.state !== m.state) {
      updated.log = [
        ...updated.log,
        {
          timestamp: Date.now(),
          matchIndex: m.matchIndex,
          message: `${m.homeSquadName} vs ${m.awaySquadName}: ${m.state} → ${ticked.state}`,
        },
      ];
    }
    // Log goals
    if (ticked.homeScore !== m.homeScore || ticked.awayScore !== m.awayScore) {
      updated.log = [
        ...updated.log,
        {
          timestamp: Date.now(),
          matchIndex: m.matchIndex,
          message: `Score: ${ticked.homeSquadName} ${ticked.homeScore} - ${ticked.awayScore} ${ticked.awaySquadName}`,
        },
      ];
    }
    return ticked;
  });
  // Keep last 100 log entries
  if (updated.log.length > 100) {
    updated.log = updated.log.slice(-100);
  }
  return updated;
}
