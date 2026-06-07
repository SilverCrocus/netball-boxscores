/**
 * One-off script to backfill extended player stats (goal2, attempt2, netPoints, etc.)
 * and TeamMatchStats for all completed matches.
 *
 * Run after deploying the expanded stats schema. Re-fetches data from Champion Data
 * and calls writeFinalStats for each completed match.
 *
 * Usage: npx tsx scripts/backfill-extended-stats.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CD_BASE = 'https://mc.championdata.com/data';
const COMP_ID = parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);

async function main() {
  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', championDataMatchId: { not: null } },
    include: {
      homeTeam: { select: { id: true, championDataTeamId: true } },
      awayTeam: { select: { id: true, championDataTeamId: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  console.log(`Found ${matches.length} completed matches to backfill\n`);

  let success = 0;
  let failed = 0;

  for (const match of matches) {
    const cdId = match.championDataMatchId!;
    try {
      const resp = await fetch(`${CD_BASE}/${COMP_ID}/${cdId}.json`, { cache: 'no-store' });
      if (!resp.ok) {
        console.log(`  ✗ R${match.round} ${cdId}: HTTP ${resp.status}`);
        failed++;
        continue;
      }
      const raw = await resp.json();
      const ms = raw.matchStats;
      if (!ms?.playerStats?.player) {
        console.log(`  ✗ R${match.round} ${cdId}: No player stats in response`);
        failed++;
        continue;
      }

      // Update player stats with extended fields
      const players = ms.playerStats.player as Array<Record<string, number>>;
      const dbPlayers = await prisma.player.findMany({
        where: { championDataPlayerId: { in: players.map((p) => p.playerId) } },
        select: { id: true, championDataPlayerId: true },
      });
      const playerMap = new Map(dbPlayers.map((p) => [p.championDataPlayerId, p.id]));

      let playerUpdated = 0;
      for (const p of players) {
        const playerId = playerMap.get(p.playerId);
        if (!playerId) continue;

        await prisma.playerMatchStats.updateMany({
          where: { playerId, matchId: match.id },
          data: {
            goal2: p.goal2 ?? 0,
            attempt2: p.attempt2 ?? 0,
            netPoints: p.netPoints ?? 0,
            points: p.points ?? 0,
            goalMisses: p.goalMisses ?? 0,
            feedWithAttempt: p.feedWithAttempt ?? 0,
            gain: p.gain ?? 0,
            pickups: p.pickups ?? 0,
            contactPenalties: p.contactPenalties ?? 0,
            obstructionPenalties: p.obstructionPenalties ?? 0,
            centrePassToGoalPerc: p.centrePassToGoalPerc ?? 0,
            quartersPlayed: p.quartersPlayed ?? 0,
            blocks: p.blocks ?? 0,
            tossUpWin: p.tossUpWin ?? 0,
            secondPhaseReceive: p.secondPhaseReceive ?? 0,
            possessionChanges: p.possessionChanges ?? 0,
            unforcedTurnovers: p.unforcedTurnovers ?? 0,
            interceptPassThrown: p.interceptPassThrown ?? 0,
          },
        });
        playerUpdated++;
      }

      // Upsert TeamMatchStats
      const teamStats = ms.teamStats?.team as Array<Record<string, number>> | undefined;
      let teamWritten = 0;
      if (teamStats) {
        for (const ts of teamStats) {
          const isHome = ts.squadId === match.homeTeam.championDataTeamId;
          const teamId = isHome ? match.homeTeam.id : match.awayTeam.id;

          await prisma.teamMatchStats.upsert({
            where: { matchId_teamId: { matchId: match.id, teamId } },
            update: {
              isHome,
              goals: ts.goals ?? 0,
              goalAttempts: ts.goalAttempts ?? 0,
              goal2: ts.goal2 ?? 0,
              attempt2: ts.attempt2 ?? 0,
              points: ts.points ?? 0,
              goalAssists: ts.goalAssists ?? 0,
              intercepts: ts.intercepts ?? 0,
              deflections: ts.deflections ?? 0,
              rebounds: ts.rebounds ?? 0,
              penalties: ts.penalties ?? 0,
              contactPenalties: ts.contactPenalties ?? 0,
              obstructionPenalties: ts.obstructionPenalties ?? 0,
              feeds: ts.feeds ?? 0,
              feedWithAttempt: ts.feedWithAttempt ?? 0,
              centrePassReceives: ts.centrePassReceives ?? 0,
              turnovers: ts.generalPlayTurnovers ?? 0,
              gain: ts.gain ?? 0,
              timeout: ts.timeout ?? 0,
              timeInPossession: ts.timeInPossession ?? 0,
              timeToScore: ts.timeToScore ?? 0,
              goalsFromCentrePass: ts.goalsFromCentrePass ?? 0,
              goalsFromGain: ts.goalsFromGain ?? 0,
              centrePassToGoalPerc: ts.centrePassToGoalPerc ?? 0,
              gainToGoalPerc: ts.gainToGoalPerc ?? 0,
              possessionChanges: ts.possessionChanges ?? 0,
              netPoints: ts.netPoints ?? 0,
              goalMisses: ts.goalMisses ?? 0,
              blocks: ts.blocks ?? 0,
              pickups: ts.pickups ?? 0,
              tossUpWin: ts.tossUpWin ?? 0,
            },
            create: {
              matchId: match.id,
              teamId,
              isHome,
              goals: ts.goals ?? 0,
              goalAttempts: ts.goalAttempts ?? 0,
              goal2: ts.goal2 ?? 0,
              attempt2: ts.attempt2 ?? 0,
              points: ts.points ?? 0,
              goalAssists: ts.goalAssists ?? 0,
              intercepts: ts.intercepts ?? 0,
              deflections: ts.deflections ?? 0,
              rebounds: ts.rebounds ?? 0,
              penalties: ts.penalties ?? 0,
              contactPenalties: ts.contactPenalties ?? 0,
              obstructionPenalties: ts.obstructionPenalties ?? 0,
              feeds: ts.feeds ?? 0,
              feedWithAttempt: ts.feedWithAttempt ?? 0,
              centrePassReceives: ts.centrePassReceives ?? 0,
              turnovers: ts.generalPlayTurnovers ?? 0,
              gain: ts.gain ?? 0,
              timeout: ts.timeout ?? 0,
              timeInPossession: ts.timeInPossession ?? 0,
              timeToScore: ts.timeToScore ?? 0,
              goalsFromCentrePass: ts.goalsFromCentrePass ?? 0,
              goalsFromGain: ts.goalsFromGain ?? 0,
              centrePassToGoalPerc: ts.centrePassToGoalPerc ?? 0,
              gainToGoalPerc: ts.gainToGoalPerc ?? 0,
              possessionChanges: ts.possessionChanges ?? 0,
              netPoints: ts.netPoints ?? 0,
              goalMisses: ts.goalMisses ?? 0,
              blocks: ts.blocks ?? 0,
              pickups: ts.pickups ?? 0,
              tossUpWin: ts.tossUpWin ?? 0,
            },
          });
          teamWritten++;
        }
      }

      console.log(`  ✓ R${match.round} ${cdId}: ${playerUpdated} players, ${teamWritten} team stats`);
      success++;
    } catch (err) {
      console.log(`  ✗ R${match.round} ${cdId}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} success, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
