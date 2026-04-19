/**
 * One-off script to backfill missing ScoreFlow entries for completed matches.
 *
 * Usage: npx tsx scripts/backfill-scoreflow.ts <matchId>
 * Example: npx tsx scripts/backfill-scoreflow.ts cmnk5d7rp004ig2imjzjfnno2
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CD_BASE = 'https://mc.championdata.com/data';
const COMP_ID = parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);

async function backfillScoreFlow(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!match) {
    console.error(`Match ${matchId} not found`);
    process.exit(1);
  }
  if (!match.championDataMatchId) {
    console.error(`Match ${matchId} has no Champion Data ID`);
    process.exit(1);
  }

  console.log(`Match: ${match.homeTeam.name} vs ${match.awayTeam.name} (CD ID: ${match.championDataMatchId})`);

  const existing = await prisma.scoreFlow.count({ where: { matchId } });
  console.log(`Existing ScoreFlow entries: ${existing}`);

  // Fetch from Champion Data
  const url = `${CD_BASE}/${COMP_ID}/${match.championDataMatchId}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    console.error(`CD API error: ${res.status}`);
    process.exit(1);
  }

  const raw = await res.json() as any;
  const ms = raw.matchStats;
  const rawScores: any[] = ms?.scoreFlow?.score ?? [];
  const homeSquadId = ms.matchInfo.homeSquadId;

  // Filter to goals only and build running scores (same as buildScoreFlow)
  const sorted = rawScores
    .filter((s: any) => s.scorepoints > 0)
    .sort((a: any, b: any) => {
      if (a.period !== b.period) return a.period - b.period;
      return a.periodSeconds - b.periodSeconds;
    });

  let runHome = 0;
  let runAway = 0;
  const entries = sorted.map((s: any) => {
    if (s.squadId === homeSquadId) runHome += s.scorepoints;
    else runAway += s.scorepoints;
    return {
      period: s.period,
      periodSeconds: s.periodSeconds,
      squadId: s.squadId,
      scorepoints: s.scorepoints,
      homeScore: runHome,
      awayScore: runAway,
    };
  });

  console.log(`CD has ${entries.length} scoring entries across periods: ${[...new Set(entries.map((e: any) => e.period))].sort().join(', ')}`);

  // Resolve scoring team IDs
  const homeTeamId = match.homeTeamId;
  const awayTeamId = match.awayTeamId;
  const homeCDId = match.homeTeam.championDataTeamId;

  const existingKeys = new Set(
    (await prisma.scoreFlow.findMany({
      where: { matchId },
      select: { period: true, periodSeconds: true },
    })).map((sf) => `${sf.period}-${sf.periodSeconds}`),
  );

  let created = 0;
  let updated = 0;

  for (const entry of entries) {
    const scoringTeamId = entry.squadId === homeCDId ? homeTeamId : awayTeamId;
    const key = `${entry.period}-${entry.periodSeconds}`;
    const isNew = !existingKeys.has(key);

    await prisma.scoreFlow.upsert({
      where: {
        matchId_period_periodSeconds: {
          matchId,
          period: entry.period,
          periodSeconds: entry.periodSeconds,
        },
      },
      update: {
        homeScore: entry.homeScore,
        awayScore: entry.awayScore,
      },
      create: {
        matchId,
        period: entry.period,
        periodSeconds: entry.periodSeconds,
        scoringTeamId,
        homeScore: entry.homeScore,
        awayScore: entry.awayScore,
        scorePoints: entry.scorepoints,
      },
    });

    if (isNew) created++;
    else updated++;
  }

  console.log(`Done: ${created} created, ${updated} updated (total: ${entries.length})`);

  const finalCount = await prisma.scoreFlow.count({ where: { matchId } });
  console.log(`Final ScoreFlow count: ${finalCount}`);
}

const matchId = process.argv[2];
if (!matchId) {
  console.error('Usage: npx tsx scripts/backfill-scoreflow.ts <matchId>');
  process.exit(1);
}

backfillScoreFlow(matchId)
  .catch(console.error)
  .finally(() => prisma.$disconnect());
