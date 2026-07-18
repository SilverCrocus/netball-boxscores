import type { Prisma } from '@prisma/client';
import { prisma, excludeSimData } from '@/lib/db';
import { resolveEditionFeatures } from '@/lib/edition-capabilities';
import { runSerializableTransaction } from '@/lib/serializable-transaction';

interface TeamRecord {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/**
 * Every transaction that can change a standings-contributing match acquires
 * this competition-scoped lock before its mutation. Rebuilds use the same
 * lock, removing the post-commit fingerprint TOCTOU window without adding a
 * schema-level version table.
 */
export async function acquireStandingsSourceLock(
  tx: Prisma.TransactionClient,
  competitionId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`centrepass:standings:${competitionId}`}, 0)
    )
  `;
}

function emptyRecord(): TeamRecord {
  return {
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  };
}

/**
 * Rebuild one edition's ladder inside the caller's transaction. Callers that
 * mutate a completed result can therefore publish the result-quality/score
 * change and matching standings atomically.
 */
export async function rebuildStandingsInTransaction(
  tx: Prisma.TransactionClient,
  competitionId: string,
): Promise<number> {
  await acquireStandingsSourceLock(tx, competitionId);

  const competition = await tx.competition.findUnique({
    where: { id: competitionId },
    select: {
      id: true,
      dataCoverage: {
        where: { matchId: null },
        select: { capability: true, state: true },
      },
    },
  });
  if (!competition) return 0;

  const candidates = await tx.match.findMany({
    where: {
      competitionId,
      status: 'COMPLETED',
      resultQuality: { in: ['UNOFFICIAL_FINAL', 'OFFICIAL_FINAL', 'CORRECTED'] },
      finalCode: null,
      OR: [
        { stageId: null },
        { stage: { is: { isPublished: true } } },
      ],
      ...excludeSimData,
    },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      dataCoverage: {
        where: { capability: 'FINAL_SCORE' },
        select: { capability: true, state: true },
      },
    },
  });
  const completedMatches = candidates.filter((match) => (
    resolveEditionFeatures(
      competition.dataCoverage,
      match.dataCoverage,
    ).finalScore.available
  ));

  const records = new Map<string, TeamRecord>();
  const getRecord = (teamId: string): TeamRecord => {
    const existing = records.get(teamId);
    if (existing) return existing;
    const created = emptyRecord();
    records.set(teamId, created);
    return created;
  };

  for (const match of completedMatches) {
    if (!match.homeTeamId || !match.awayTeamId) continue;
    const home = getRecord(match.homeTeamId);
    const away = getRecord(match.awayTeamId);

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.wins += 1;
      home.points += 4;
      away.losses += 1;
    } else if (match.awayScore > match.homeScore) {
      away.wins += 1;
      away.points += 4;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 2;
      away.points += 2;
    }
  }

  const sorted = [...records.entries()].sort((left, right) => {
    if (right[1].points !== left[1].points) return right[1].points - left[1].points;
    const leftPct = left[1].goalsAgainst > 0
      ? left[1].goalsFor / left[1].goalsAgainst
      : 0;
    const rightPct = right[1].goalsAgainst > 0
      ? right[1].goalsFor / right[1].goalsAgainst
      : 0;
    return rightPct - leftPct;
  });

  await tx.standing.deleteMany({ where: { competitionId } });
  for (let index = 0; index < sorted.length; index += 1) {
    const [teamId, record] = sorted[index];
    const goalPercentage = record.goalsAgainst > 0
      ? Number(((record.goalsFor / record.goalsAgainst) * 100).toFixed(1))
      : 0;
    const data = {
      rank: index + 1,
      played: record.played,
      wins: record.wins,
      losses: record.losses,
      draws: record.draws,
      goalsFor: record.goalsFor,
      goalsAgainst: record.goalsAgainst,
      goalPercentage,
      points: record.points,
    };

    await tx.standing.upsert({
      where: { competitionId_teamId: { competitionId, teamId } },
      update: data,
      create: { competitionId, teamId, ...data },
    });
  }

  return sorted.length;
}

/**
 * Recalculate standings from final, public-score-capable matches.
 *
 * SSN points: 4 win, 2 draw, 0 loss. Goal percentage is goals for divided by
 * goals against. The advisory lock and serializable transaction coordinate
 * this maintenance rebuild with every result mutation in processing.ts.
 */
export async function recalculateStandings(): Promise<void> {
  const compId = Number.parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);
  const competition = await prisma.competition.findUnique({
    where: { championDataId: compId },
    select: { id: true },
  });

  if (!competition) {
    console.warn(`[Standings] Competition with championDataId ${compId} not found — skipping`);
    return;
  }

  const teamCount = await runSerializableTransaction((tx) => (
    rebuildStandingsInTransaction(tx, competition.id)
  ));
  console.log(`[Standings] Recalculated standings for ${teamCount} teams`);
}
