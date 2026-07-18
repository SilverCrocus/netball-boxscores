/**
 * One-time fix: re-sync COMPLETED match scores against the canonical
 * Champion Data fixture (homeSquadScore/awaySquadScore), then recalculate
 * standings.
 *
 * Background: the worker only reconciles LIVE/SCHEDULED matches against the
 * fixture. Once a match is COMPLETED in the DB, its score is never re-checked,
 * so a score captured a beat before the true final (e.g. a final super shot)
 * stays stale forever. This corrects that drift.
 *
 * Usage: npx tsx scripts/resync-completed-scores.ts
 */
import { prisma, excludeSimData } from '@/lib/db';
import { fetchFixture } from '@/lib/champion-data';
import { recalculateStandings } from '@/lib/standings';

async function main() {
  const compId = parseInt(process.env.SSN_COMPETITION_ID ?? '12949', 10);
  const fixture = await fetchFixture(compId);
  const fixtureMap = new Map(fixture.map((fm) => [fm.matchId, fm]));

  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', ...excludeSimData, championDataMatchId: { not: null } },
    include: {
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
    orderBy: [{ round: 'asc' }, { scheduledAt: 'asc' }],
  });

  let fixed = 0;
  for (const m of matches) {
    if (!m.homeTeam || !m.awayTeam) continue;
    const fx = fixtureMap.get(m.championDataMatchId!);
    if (!fx || fx.matchStatus.toLowerCase() !== 'complete') continue;

    const cdH = fx.homeSquadScore;
    const cdA = fx.awaySquadScore;
    if (cdH === m.homeScore && cdA === m.awayScore) continue;

    console.log(
      `R${m.round} ${m.homeTeam.name} v ${m.awayTeam.name}: ` +
      `${m.homeScore}-${m.awayScore} → ${cdH}-${cdA}`,
    );
    await prisma.match.update({
      where: { id: m.id },
      data: { homeScore: cdH, awayScore: cdA },
    });
    fixed++;
  }

  console.log(`\nRe-synced ${fixed} match score(s). Recalculating standings…`);
  await recalculateStandings();

  const standings = await prisma.standing.findMany({
    include: { team: { select: { name: true } } },
    orderBy: { rank: 'asc' },
  });
  console.log('\nRank  Team                       W-L-D   Pts  GF   GA   G%');
  console.log('─'.repeat(64));
  for (const s of standings) {
    console.log(
      `${String(s.rank).padStart(2)}    ${s.team.name.padEnd(26)} ${s.wins}-${s.losses}-${s.draws}  ${String(s.points).padStart(3)} ${String(s.goalsFor).padStart(4)} ${String(s.goalsAgainst).padStart(4)}  ${s.goalPercentage.toFixed(1)}%`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
