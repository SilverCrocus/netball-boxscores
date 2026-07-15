/**
 * Cleanup orphaned simulation data from the database.
 *
 * Simulation matches are identified by the explicit Match.isSimulation flag.
 * This script deletes those matches and all their child records.
 *
 * Usage: npx tsx scripts/cleanup-sim-data.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Never infer simulations from provider IDs or round numbers: both can overlap
  // with legitimate competition data.
  const simMatches = await prisma.match.findMany({
    where: { isSimulation: true },
    select: {
      id: true,
      round: true,
      championDataMatchId: true,
      homeScore: true,
      awayScore: true,
      status: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
  });

  if (simMatches.length === 0) {
    console.log('No simulation data found in the database. All clean!');
    return;
  }

  console.log(`Found ${simMatches.length} simulation match(es):\n`);
  for (const m of simMatches) {
    console.log(
      `  - ${m.homeTeam.name} vs ${m.awayTeam.name} ` +
      `(${m.homeScore}-${m.awayScore}, ${m.status}, ` +
      `round=${m.round}, cdMatchId=${m.championDataMatchId})`
    );
  }

  const matchIds = simMatches.map((m) => m.id);

  // Delete child records first, then matches
  const scoreFlowResult = await prisma.scoreFlow.deleteMany({
    where: { matchId: { in: matchIds } },
  });
  console.log(`\nDeleted ${scoreFlowResult.count} ScoreFlow records`);

  const playerStatsResult = await prisma.playerMatchStats.deleteMany({
    where: { matchId: { in: matchIds } },
  });
  console.log(`Deleted ${playerStatsResult.count} PlayerMatchStats records`);

  const quarterResult = await prisma.matchQuarter.deleteMany({
    where: { matchId: { in: matchIds } },
  });
  console.log(`Deleted ${quarterResult.count} MatchQuarter records`);

  // Also delete any user favorites/reminders referencing sim matches
  const favResult = await prisma.userFavorite.deleteMany({
    where: { matchId: { in: matchIds } },
  });
  if (favResult.count > 0) {
    console.log(`Deleted ${favResult.count} UserFavorite records`);
  }

  const reminderResult = await prisma.userReminder.deleteMany({
    where: { matchId: { in: matchIds } },
  });
  if (reminderResult.count > 0) {
    console.log(`Deleted ${reminderResult.count} UserReminder records`);
  }

  const matchResult = await prisma.match.deleteMany({
    where: { id: { in: matchIds } },
  });
  console.log(`Deleted ${matchResult.count} Match records`);

  console.log('\nSimulation data cleaned up successfully!');
}

main()
  .catch((e) => {
    console.error('Cleanup failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
