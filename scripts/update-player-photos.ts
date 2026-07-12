/**
 * Fetches player photos from TheSportsDB and updates the database.
 * Uses fuzzy name matching to handle CD↔TSDB name differences.
 *
 * Usage: npx tsx scripts/update-player-photos.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

const SSN_TEAM_IDS = [
  '136598', // Adelaide Thunderbirds
  '136600', // Giants Netball
  '148110', // Melbourne Mavericks
  '136601', // Melbourne Vixens
  '136602', // New South Wales Swifts
  '136603', // Queensland Firebirds
  '136604', // Sunshine Coast Lightning
  '136605', // West Coast Fever
];

// Players whose CD names differ significantly from TheSportsDB
const NAME_ALIASES: Record<string, string> = {
  'Shamera Sterling-Humphrey': 'Shamera Sterling',
  'Romelda Aiken-George': 'Romelda Aiken',
};

interface TSDBPlayer {
  idPlayer: string;
  strPlayer: string;
  strTeam: string;
  strCutout: string | null;
  strThumb: string | null;
  strRender: string | null;
}

async function fetchJSON<T>(url: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 429) {
      const wait = (attempt + 1) * 5000;
      console.log(`  Rate limited, waiting ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Fetch error: ${res.status}`);
  }
  throw new Error('Max retries exceeded (429)');
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/-/g, ' ')
    .trim();
}

function lastNameMatch(a: string, b: string): boolean {
  const partsA = normalize(a).split(/\s+/);
  const partsB = normalize(b).split(/\s+/);
  const lastA = partsA[partsA.length - 1];
  const lastB = partsB[partsB.length - 1];
  return lastA === lastB;
}

function firstInitialMatch(a: string, b: string): boolean {
  const normA = normalize(a);
  const normB = normalize(b);
  return normA[0] === normB[0];
}

function isShortForm(short: string, full: string): boolean {
  const s = normalize(short).split(/\s+/)[0];
  const f = normalize(full).split(/\s+/)[0];
  return f.startsWith(s) || s.startsWith(f);
}

function matchScore(dbName: string, tsdbName: string): number {
  const normDb = normalize(dbName);
  const normTsdb = normalize(tsdbName);

  if (normDb === normTsdb) return 100;

  if (!lastNameMatch(dbName, tsdbName)) return 0;
  if (!firstInitialMatch(dbName, tsdbName)) return 0;

  const dbParts = normDb.split(/\s+/);
  const tsdbParts = normTsdb.split(/\s+/);

  if (dbParts[0] === tsdbParts[0]) return 90;
  if (isShortForm(dbParts[0], tsdbParts[0])) return 80;

  return 50;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('=== DRY RUN ===\n');

  // Fetch all TSDB players
  console.log('Fetching TheSportsDB rosters...');
  const tsdbPlayers: TSDBPlayer[] = [];
  for (const teamId of SSN_TEAM_IDS) {
    await new Promise((r) => setTimeout(r, 2000));
    const data = await fetchJSON<{ player: TSDBPlayer[] | null }>(
      `${TSDB_BASE}/lookup_all_players.php?id=${teamId}`,
    );
    tsdbPlayers.push(...(data.player ?? []));
  }
  console.log(`TSDB players: ${tsdbPlayers.length}\n`);

  // Get all DB players
  const dbPlayers = await prisma.player.findMany({
    include: { team: { select: { name: true } } },
  });

  const NETBALL_KEYWORDS = [
    'netball', 'fever', 'vixens', 'swifts', 'firebirds',
    'lightning', 'thunderbirds', 'mavericks', 'pulse', 'tactix',
    'mystics', 'magic', 'steel', 'stars', 'ferns', 'diamonds',
    'roses', 'panthers',
  ];

  async function searchPlayer(name: string): Promise<TSDBPlayer | null> {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const data = await fetchJSON<{ player: TSDBPlayer[] | null }>(
        `${TSDB_BASE}/searchplayers.php?p=${encodeURIComponent(name)}`,
      );
      const results = data.player ?? [];
      // Prefer SSN team, fall back to any netball team
      return (
        results.find((p) =>
          ['netball', 'fever', 'vixens', 'swifts', 'firebirds', 'lightning', 'thunderbirds', 'mavericks']
            .some((kw) => p.strTeam?.toLowerCase().includes(kw)),
        ) ??
        results.find((p) =>
          NETBALL_KEYWORDS.some((kw) => p.strTeam?.toLowerCase().includes(kw)),
        ) ??
        null
      );
    } catch {
      return null;
    }
  }

  let updated = 0;
  let alreadyHadPhoto = 0;
  let matched = 0;
  let searched = 0;
  const unmatched: string[] = [];

  for (const dbPlayer of dbPlayers) {
    // Check alias first
    const aliasName = NAME_ALIASES[dbPlayer.name];
    let bestMatch: TSDBPlayer | null = null;
    let bestScore = 0;

    if (aliasName) {
      const aliasMatch = tsdbPlayers.find(
        (t) => normalize(t.strPlayer) === normalize(aliasName),
      );
      if (aliasMatch) {
        bestMatch = aliasMatch;
        bestScore = 95;
      }
    }

    if (!bestMatch) {
      for (const tsdb of tsdbPlayers) {
        const score = matchScore(dbPlayer.name, tsdb.strPlayer);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = tsdb;
        }
      }
    }

    const photo = bestMatch
      ? bestMatch.strCutout || bestMatch.strThumb || bestMatch.strRender
      : null;

    if (bestScore >= 50 && photo) {
      matched++;
      if (dbPlayer.photoUrl) {
        alreadyHadPhoto++;
        continue;
      }

      const label = bestScore < 100
        ? ` (fuzzy: "${dbPlayer.name}" → "${bestMatch!.strPlayer}", score ${bestScore})`
        : '';
      console.log(`  UPDATE ${dbPlayer.name} [${dbPlayer.team.name}]${label}`);

      if (!dryRun) {
        const existingTsdb = await prisma.player.findFirst({
          where: { theSportsDbId: bestMatch!.idPlayer, id: { not: dbPlayer.id } },
        });
        await prisma.player.update({
          where: { id: dbPlayer.id },
          data: {
            photoUrl: photo,
            ...(existingTsdb ? {} : { theSportsDbId: bestMatch!.idPlayer }),
          },
        });
      }
      updated++;
    } else {
      if (!dbPlayer.photoUrl) {
        // Try individual search by name, then by alias
        const namesToTry = [dbPlayer.name];
        if (aliasName) namesToTry.push(aliasName);

        let found = false;
        for (const searchName of namesToTry) {
          const searchResult = await searchPlayer(searchName);
          if (searchResult) {
            const searchPhoto = searchResult.strCutout || searchResult.strThumb || searchResult.strRender;
            if (searchPhoto) {
              searched++;
              console.log(`  SEARCH ${dbPlayer.name} [${dbPlayer.team.name}] → "${searchResult.strPlayer}" (${searchResult.strTeam})`);
              if (!dryRun) {
                await prisma.player.update({
                  where: { id: dbPlayer.id },
                  data: { photoUrl: searchPhoto, theSportsDbId: searchResult.idPlayer },
                });
              }
              updated++;
              found = true;
              break;
            }
          }
        }
        if (!found) unmatched.push(`${dbPlayer.name} [${dbPlayer.team.name}]`);
      } else {
        alreadyHadPhoto++;
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total DB players: ${dbPlayers.length}`);
  console.log(`Already had photo: ${alreadyHadPhoto}`);
  console.log(`Matched from roster: ${matched} (${updated} updated, ${matched - updated + alreadyHadPhoto} already had)`);
  console.log(`Found via search: ${searched}`);
  console.log(`Updated total: ${updated}`);

  if (unmatched.length > 0) {
    console.log(`\nStill missing (${unmatched.length}):`);
    for (const name of unmatched) {
      console.log(`  - ${name}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
