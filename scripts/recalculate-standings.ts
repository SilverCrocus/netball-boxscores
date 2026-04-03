/**
 * Recalculate standings from all completed matches and print a summary.
 *
 * Usage: npx tsx scripts/recalculate-standings.ts
 */
import { prisma } from '@/lib/db';
import { recalculateStandings } from '@/lib/standings';

async function main() {
  await recalculateStandings();

  const standings = await prisma.standing.findMany({
    include: { team: { select: { name: true } } },
    orderBy: [{ points: 'desc' }, { goalPercentage: 'desc' }],
  });

  if (standings.length === 0) {
    console.log('No standings found.');
    return;
  }

  console.log('\nRank  Team                           W-L-D    Pts   GF   GA   G%');
  console.log('\u2500'.repeat(70));
  for (const s of standings) {
    const name = s.team.name.padEnd(30);
    const wld = `${s.wins}-${s.losses}-${s.draws}`.padEnd(8);
    const pts = String(s.points).padStart(3);
    const gf = String(s.goalsFor).padStart(4);
    const ga = String(s.goalsAgainst).padStart(4);
    const pct = s.goalPercentage.toFixed(1);
    console.log(`${String(s.rank).padStart(2)}    ${name} ${wld} ${pts} ${gf} ${ga}  ${pct}%`);
  }

  console.log(`\nStandings recalculated for ${standings.length} teams.`);
}

main()
  .catch((e) => {
    console.error('Recalculation failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
