import { prisma, excludeSimData } from '@/lib/db';

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
 * Recalculate standings from all COMPLETED matches.
 *
 * SSN points: 4 win, 2 draw, 0 loss, +2 bonus for winning by 16+ goals.
 * Goal percentage: (goalsFor / goalsAgainst) * 100 (0 if no goals against).
 * Sorted by points desc, then goal percentage desc.
 */
export async function recalculateStandings(): Promise<void> {
  const compId = parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);

  const competition = await prisma.competition.findUnique({
    where: { championDataId: compId },
  });

  if (!competition) {
    console.warn(`[Standings] Competition with championDataId ${compId} not found — skipping`);
    return;
  }

  const completedMatches = await prisma.match.findMany({
    where: {
      competitionId: competition.id,
      status: 'COMPLETED',
      ...excludeSimData,
    },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  });

  const records = new Map<string, TeamRecord>();

  function getRecord(teamId: string): TeamRecord {
    let rec = records.get(teamId);
    if (!rec) {
      rec = { played: 0, wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
      records.set(teamId, rec);
    }
    return rec;
  }

  for (const m of completedMatches) {
    const home = getRecord(m.homeTeamId);
    const away = getRecord(m.awayTeamId);

    home.played++;
    away.played++;
    home.goalsFor += m.homeScore;
    home.goalsAgainst += m.awayScore;
    away.goalsFor += m.awayScore;
    away.goalsAgainst += m.homeScore;

    if (m.homeScore > m.awayScore) {
      home.wins++;
      home.points += 4;
      away.losses++;
      if (m.homeScore - m.awayScore >= 16) {
        home.points += 2;
      }
    } else if (m.awayScore > m.homeScore) {
      away.wins++;
      away.points += 4;
      home.losses++;
      if (m.awayScore - m.homeScore >= 16) {
        away.points += 2;
      }
    } else {
      home.draws++;
      away.draws++;
      home.points += 2;
      away.points += 2;
    }
  }

  const sorted = [...records.entries()].sort((a, b) => {
    if (b[1].points !== a[1].points) return b[1].points - a[1].points;
    const pctA = a[1].goalsAgainst > 0 ? a[1].goalsFor / a[1].goalsAgainst : 0;
    const pctB = b[1].goalsAgainst > 0 ? b[1].goalsFor / b[1].goalsAgainst : 0;
    return pctB - pctA;
  });

  for (let i = 0; i < sorted.length; i++) {
    const [teamId, rec] = sorted[i];
    const goalPercentage =
      rec.goalsAgainst > 0
        ? parseFloat(((rec.goalsFor / rec.goalsAgainst) * 100).toFixed(1))
        : 0;

    await prisma.standing.upsert({
      where: {
        competitionId_teamId: {
          competitionId: competition.id,
          teamId,
        },
      },
      update: {
        rank: i + 1,
        played: rec.played,
        wins: rec.wins,
        losses: rec.losses,
        draws: rec.draws,
        goalsFor: rec.goalsFor,
        goalsAgainst: rec.goalsAgainst,
        goalPercentage,
        points: rec.points,
      },
      create: {
        competitionId: competition.id,
        teamId,
        rank: i + 1,
        played: rec.played,
        wins: rec.wins,
        losses: rec.losses,
        draws: rec.draws,
        goalsFor: rec.goalsFor,
        goalsAgainst: rec.goalsAgainst,
        goalPercentage,
        points: rec.points,
      },
    });
  }

  console.log(`[Standings] Recalculated standings for ${sorted.length} teams`);
}
