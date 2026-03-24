import { PrismaClient, Position, MatchStatus } from "@prisma/client";
import type { CDFixtureMatch } from "../src/types/champion-data";
import type { TSDBTeam, TSDBPlayer } from "../src/types/the-sports-db";

const prisma = new PrismaClient();

// ───── API base URLs ─────
const CD_BASE = "https://mc.championdata.com/data";
const TSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";

// ───── Constants ─────
const SSN_2026_COMP_ID = 12949;
const SSN_LEAGUE_NAME = "Australian Super Netball League";

// Champion Data team names that differ from TheSportsDB
const CD_TO_TSDB_NAME: Record<string, string> = {
  "GIANTS Netball": "Giants Netball",
  "NSW Swifts": "New South Wales Swifts",
};

// TheSportsDB position strings to Prisma Position enum
const POSITION_MAP: Record<string, Position> = {
  "Goal Shooter": Position.GS,
  "Goal Attack": Position.GA,
  "Wing Attack": Position.WA,
  Centre: Position.C,
  "Wing Defence": Position.WD,
  "Goal Defence": Position.GD,
  "Goal Keeper": Position.GK,
  GS: Position.GS,
  GA: Position.GA,
  WA: Position.WA,
  C: Position.C,
  WD: Position.WD,
  GD: Position.GD,
  GK: Position.GK,
};

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

async function main() {
  console.log("🏐 Seeding NETPULSE with real SSN data...\n");

  // ─── Step 1: Clean existing data ───
  console.log("Cleaning existing data...");
  await prisma.scoreFlow.deleteMany();
  await prisma.playerMatchStats.deleteMany();
  await prisma.matchQuarter.deleteMany();
  await prisma.userFavorite.deleteMany();
  await prisma.userReminder.deleteMany();
  await prisma.userTeam.deleteMany();
  await prisma.match.deleteMany();
  await prisma.standing.deleteMany();
  await prisma.player.deleteMany();
  await prisma.team.deleteMany();
  await prisma.competition.deleteMany();

  // ─── Step 2: Fetch real data from APIs ───
  console.log("Fetching Champion Data fixture...");
  const fixtureData = await fetchJSON<{ fixture: { match: CDFixtureMatch[] } }>(
    `${CD_BASE}/${SSN_2026_COMP_ID}/fixture.json`
  );
  const cdMatches = fixtureData.fixture.match;
  console.log(`  Found ${cdMatches.length} matches`);

  console.log("Fetching TheSportsDB teams...");
  const tsdbData = await fetchJSON<{ teams: TSDBTeam[] | null }>(
    `${TSDB_BASE}/search_all_teams.php?l=${encodeURIComponent(SSN_LEAGUE_NAME)}`
  );
  const tsdbTeams = tsdbData.teams ?? [];
  console.log(`  Found ${tsdbTeams.length} teams`);

  const tsdbTeamMap = new Map<string, TSDBTeam>();
  for (const t of tsdbTeams) {
    tsdbTeamMap.set(t.strTeam.toLowerCase(), t);
  }

  // ─── Step 3: Create competition ───
  const comp = await prisma.competition.create({
    data: {
      name: "Suncorp Super Netball 2026",
      season: 2026,
      championDataId: SSN_2026_COMP_ID,
      seasonStart: new Date("2026-03-14"),
      seasonEnd: new Date("2026-08-09"),
    },
  });
  console.log(`\nCreated competition: ${comp.name}`);

  // ─── Step 4: Extract unique teams from fixture & create them ───
  const cdTeamMap = new Map<number, { name: string; code: string; nickname: string }>();
  for (const m of cdMatches) {
    if (!cdTeamMap.has(m.homeSquadId)) {
      cdTeamMap.set(m.homeSquadId, {
        name: m.homeSquadName,
        code: m.homeSquadCode,
        nickname: m.homeSquadNickname,
      });
    }
    if (!cdTeamMap.has(m.awaySquadId)) {
      cdTeamMap.set(m.awaySquadId, {
        name: m.awaySquadName,
        code: m.awaySquadCode,
        nickname: m.awaySquadNickname,
      });
    }
  }

  // Create teams and store mapping from CD squad ID → Prisma team ID
  const squadIdToPrismaId = new Map<number, string>();
  const teamCount = cdTeamMap.size;

  for (const [squadId, info] of cdTeamMap) {
    // Look up TheSportsDB team for badge/banner
    const tsdbName = (CD_TO_TSDB_NAME[info.name] || info.name).toLowerCase();
    const tsdbTeam = tsdbTeamMap.get(tsdbName);

    const slug = info.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const team = await prisma.team.create({
      data: {
        name: info.name,
        slug,
        abbreviation: info.code,
        logoUrl: tsdbTeam?.strBadge || null,
        bannerUrl: tsdbTeam?.strBanner || null,
        championDataTeamId: squadId,
        competitionId: comp.id,
      },
    });

    squadIdToPrismaId.set(squadId, team.id);
    console.log(
      `  Team: ${info.name} (${info.code}) ${tsdbTeam ? "✓ badge" : "✗ no badge"}`
    );
  }

  // ─── Step 5: Fetch full rosters from TheSportsDB ───
  console.log("\nFetching player rosters from TheSportsDB...");
  let totalPlayers = 0;

  for (const [squadId, info] of cdTeamMap) {
    const tsdbName = (CD_TO_TSDB_NAME[info.name] || info.name).toLowerCase();
    const tsdbTeam = tsdbTeamMap.get(tsdbName);

    if (!tsdbTeam) {
      console.log(`  ⚠ No TSDB team found for ${info.name}, skipping roster`);
      continue;
    }

    const prismaTeamId = squadIdToPrismaId.get(squadId)!;

    try {
      const playerData = await fetchJSON<{ player: TSDBPlayer[] | null }>(
        `${TSDB_BASE}/lookup_all_players.php?id=${tsdbTeam.idTeam}`
      );
      const players = playerData.player ?? [];

      for (const p of players) {
        const position = POSITION_MAP[p.strPosition];
        if (!position) continue; // Skip non-netball positions

        const photoUrl = p.strCutout || p.strThumb || p.strRender || null;

        await prisma.player.create({
          data: {
            name: p.strPlayer,
            position,
            photoUrl,
            teamId: prismaTeamId,
          },
        });
        totalPlayers++;
      }

      console.log(`  ${info.name}: ${players.filter((p) => POSITION_MAP[p.strPosition]).length} players`);
    } catch (err) {
      console.log(`  ⚠ Failed to fetch roster for ${info.name}: ${err}`);
    }
  }

  // ─── Step 6: Seed all matches from Champion Data ───
  console.log("\nSeeding matches...");
  let completedCount = 0;
  let scheduledCount = 0;
  let liveCount = 0;

  for (const m of cdMatches) {
    const homeTeamId = squadIdToPrismaId.get(m.homeSquadId);
    const awayTeamId = squadIdToPrismaId.get(m.awaySquadId);

    if (!homeTeamId || !awayTeamId) {
      console.log(`  ⚠ Skipping match ${m.matchId}: missing team mapping`);
      continue;
    }

    const status = m.matchStatus.toLowerCase();
    let matchStatus: MatchStatus;
    if (status === "complete") {
      matchStatus = MatchStatus.COMPLETED;
      completedCount++;
    } else if (status === "playing") {
      matchStatus = MatchStatus.LIVE;
      liveCount++;
    } else {
      matchStatus = MatchStatus.SCHEDULED;
      scheduledCount++;
    }

    await prisma.match.create({
      data: {
        competitionId: comp.id,
        homeTeamId,
        awayTeamId,
        round: m.roundNumber,
        venue: m.venueName,
        scheduledAt: new Date(m.utcStartTime),
        status: matchStatus,
        homeScore: m.homeSquadScore ?? 0,
        awayScore: m.awaySquadScore ?? 0,
        championDataMatchId: m.matchId,
        currentQuarter: status === "playing" ? m.period : null,
      },
    });
  }

  console.log(
    `  Created ${cdMatches.length} matches (${completedCount} completed, ${liveCount} live, ${scheduledCount} scheduled)`
  );

  // ─── Step 7: Compute standings from completed matches ───
  console.log("\nComputing standings from results...");

  interface TeamRecord {
    prismaId: string;
    played: number;
    wins: number;
    losses: number;
    draws: number;
    goalsFor: number;
    goalsAgainst: number;
    points: number;
  }

  const records = new Map<number, TeamRecord>();
  for (const [squadId] of cdTeamMap) {
    records.set(squadId, {
      prismaId: squadIdToPrismaId.get(squadId)!,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });
  }

  // SSN points: 4 for win, 2 for draw, 0 for loss
  // Bonus point: 2 if win by 16+ goals
  for (const m of cdMatches) {
    if (m.matchStatus.toLowerCase() !== "complete") continue;

    const homeRec = records.get(m.homeSquadId)!;
    const awayRec = records.get(m.awaySquadId)!;

    homeRec.played++;
    awayRec.played++;
    homeRec.goalsFor += m.homeSquadScore;
    homeRec.goalsAgainst += m.awaySquadScore;
    awayRec.goalsFor += m.awaySquadScore;
    awayRec.goalsAgainst += m.homeSquadScore;

    if (m.homeSquadScore > m.awaySquadScore) {
      homeRec.wins++;
      homeRec.points += 4;
      awayRec.losses++;
      // Bonus for 16+ goal margin
      if (m.homeSquadScore - m.awaySquadScore >= 16) {
        homeRec.points += 2;
      }
    } else if (m.awaySquadScore > m.homeSquadScore) {
      awayRec.wins++;
      awayRec.points += 4;
      homeRec.losses++;
      if (m.awaySquadScore - m.homeSquadScore >= 16) {
        awayRec.points += 2;
      }
    } else {
      homeRec.draws++;
      awayRec.draws++;
      homeRec.points += 2;
      awayRec.points += 2;
    }
  }

  // Sort by points desc, then goal percentage desc
  const sorted = [...records.entries()].sort((a, b) => {
    if (b[1].points !== a[1].points) return b[1].points - a[1].points;
    const pctA = a[1].goalsAgainst > 0 ? a[1].goalsFor / a[1].goalsAgainst : 0;
    const pctB = b[1].goalsAgainst > 0 ? b[1].goalsFor / b[1].goalsAgainst : 0;
    return pctB - pctA;
  });

  for (let i = 0; i < sorted.length; i++) {
    const [, rec] = sorted[i];
    const goalPct =
      rec.goalsAgainst > 0
        ? parseFloat(((rec.goalsFor / rec.goalsAgainst) * 100).toFixed(1))
        : 0;

    await prisma.standing.create({
      data: {
        competitionId: comp.id,
        teamId: rec.prismaId,
        rank: i + 1,
        played: rec.played,
        wins: rec.wins,
        losses: rec.losses,
        draws: rec.draws,
        goalsFor: rec.goalsFor,
        goalsAgainst: rec.goalsAgainst,
        goalPercentage: goalPct,
        points: rec.points,
      },
    });
  }

  console.log(`  Created standings for ${sorted.length} teams`);

  // ─── Done ───
  console.log("\n✅ Seed completed!");
  console.log(`  Competition: 1`);
  console.log(`  Teams: ${teamCount}`);
  console.log(`  Players: ${totalPlayers}`);
  console.log(`  Matches: ${cdMatches.length}`);
  console.log(`  Standings: ${sorted.length}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
