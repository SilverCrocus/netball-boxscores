import { PrismaClient, Position, MatchStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clean existing data
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

  // Create 2 competitions
  const comp2025 = await prisma.competition.create({
    data: {
      name: "Suncorp Super Netball 2025",
      season: 2025,
      championDataId: 10724,
      seasonStart: new Date("2025-03-29"),
      seasonEnd: new Date("2025-08-10"),
    },
  });

  const comp2026 = await prisma.competition.create({
    data: {
      name: "Suncorp Super Netball 2026",
      season: 2026,
      championDataId: 10850,
      seasonStart: new Date("2026-03-28"),
      seasonEnd: new Date("2026-08-09"),
    },
  });

  // 8 SSN teams (2026 season)
  const teamData = [
    {
      name: "Melbourne Vixens",
      slug: "melbourne-vixens",
      abbreviation: "VIX",
      primaryColor: "#E31837",
      secondaryColor: "#000000",
      championDataTeamId: 810,
    },
    {
      name: "West Coast Fever",
      slug: "west-coast-fever",
      abbreviation: "FEV",
      primaryColor: "#00A651",
      secondaryColor: "#FDB515",
      championDataTeamId: 811,
    },
    {
      name: "NSW Swifts",
      slug: "nsw-swifts",
      abbreviation: "SWI",
      primaryColor: "#E4002B",
      secondaryColor: "#002D62",
      championDataTeamId: 812,
    },
    {
      name: "Queensland Firebirds",
      slug: "queensland-firebirds",
      abbreviation: "FIR",
      primaryColor: "#7B2D8E",
      secondaryColor: "#F47920",
      championDataTeamId: 813,
    },
    {
      name: "Adelaide Thunderbirds",
      slug: "adelaide-thunderbirds",
      abbreviation: "THU",
      primaryColor: "#E91C72",
      secondaryColor: "#1E1E1E",
      championDataTeamId: 814,
    },
    {
      name: "GIANTS Netball",
      slug: "giants-netball",
      abbreviation: "GIA",
      primaryColor: "#F47B20",
      secondaryColor: "#2B2B2B",
      championDataTeamId: 815,
    },
    {
      name: "Collingwood Magpies",
      slug: "collingwood-magpies",
      abbreviation: "MAG",
      primaryColor: "#000000",
      secondaryColor: "#FFFFFF",
      championDataTeamId: 816,
    },
    {
      name: "Sunshine Coast Lightning",
      slug: "sunshine-coast-lightning",
      abbreviation: "LIG",
      primaryColor: "#702F8A",
      secondaryColor: "#FFD100",
      championDataTeamId: 817,
    },
  ];

  const teams = [];
  for (const td of teamData) {
    const team = await prisma.team.create({
      data: { ...td, competitionId: comp2026.id },
    });
    teams.push(team);
  }

  // Create 3 players per team (GS, C, GK as representative positions)
  const positionsPerTeam: Position[] = [Position.GS, Position.C, Position.GK];
  const playerNames = [
    ["Mwai Kumwenda", "Kate Moloney", "Emily Mannix"],
    ["Jhaniele Fowler", "Verity Simmons", "Courtney Bruce"],
    ["Sophie Garbin", "Maddy Proud", "Sarah Klau"],
    ["Donnell Wallam", "Kim Ravaillion", "Ruby Bakewell-Doran"],
    ["Lenize Potgieter", "Georgie Horjus", "Shamera Sterling"],
    ["Sophie Dwyer", "Amy Parmenter", "April Brandley"],
    ["Shimona Nelson", "Kelsey Browne", "Geva Mentor"],
    ["Cara Koenen", "Laura Langman", "Phumza Maweni"],
  ];

  const allPlayers = [];
  for (let t = 0; t < teams.length; t++) {
    for (let p = 0; p < positionsPerTeam.length; p++) {
      const player = await prisma.player.create({
        data: {
          name: playerNames[t][p],
          position: positionsPerTeam[p],
          teamId: teams[t].id,
          championDataPlayerId: 9000 + t * 10 + p,
        },
      });
      allPlayers.push(player);
    }
  }

  // Create 4 matches (2 completed, 1 live, 1 scheduled)
  const match1 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[0].id, // Vixens
      awayTeamId: teams[1].id, // Fever
      round: 1,
      venue: "John Cain Arena",
      scheduledAt: new Date("2026-03-28T06:00:00Z"),
      status: MatchStatus.COMPLETED,
      homeScore: 64,
      awayScore: 58,
      championDataMatchId: 115001,
    },
  });

  const match2 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[2].id, // Swifts
      awayTeamId: teams[3].id, // Firebirds
      round: 1,
      venue: "Ken Rosewall Arena",
      scheduledAt: new Date("2026-03-28T08:00:00Z"),
      status: MatchStatus.COMPLETED,
      homeScore: 55,
      awayScore: 62,
      championDataMatchId: 115002,
    },
  });

  const match3 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[4].id, // Thunderbirds
      awayTeamId: teams[5].id, // GIANTS
      round: 2,
      venue: "Adelaide Entertainment Centre",
      scheduledAt: new Date("2026-04-04T07:00:00Z"),
      status: MatchStatus.LIVE,
      homeScore: 32,
      awayScore: 28,
      currentQuarter: 3,
      currentTime: "8:45",
      championDataMatchId: 115003,
    },
  });

  const match4 = await prisma.match.create({
    data: {
      competitionId: comp2026.id,
      homeTeamId: teams[6].id, // Magpies
      awayTeamId: teams[7].id, // Lightning
      round: 2,
      venue: "John Cain Arena",
      scheduledAt: new Date("2026-04-05T06:00:00Z"),
      status: MatchStatus.SCHEDULED,
      championDataMatchId: 115004,
    },
  });

  // Quarter scores for completed match 1
  await prisma.matchQuarter.createMany({
    data: [
      { matchId: match1.id, quarter: 1, homeScore: 16, awayScore: 14 },
      { matchId: match1.id, quarter: 2, homeScore: 14, awayScore: 17 },
      { matchId: match1.id, quarter: 3, homeScore: 18, awayScore: 12 },
      { matchId: match1.id, quarter: 4, homeScore: 16, awayScore: 15 },
    ],
  });

  // Player stats for match 1 (Vixens GS)
  await prisma.playerMatchStats.create({
    data: {
      playerId: allPlayers[0].id, // Kumwenda (Vixens GS)
      matchId: match1.id,
      goals: 42,
      attempts: 45,
      goalAssists: 0,
      intercepts: 0,
      deflections: 1,
      rebounds: 4,
      penalties: 2,
      feeds: 3,
      centrePassReceives: 0,
      turnovers: 2,
      minutesPlayed: 60,
    },
  });

  // Score flow entries for match 1 Q1
  await prisma.scoreFlow.createMany({
    data: [
      {
        matchId: match1.id,
        period: 1,
        periodSeconds: 45,
        scoringTeamId: teams[0].id,
        homeScore: 1,
        awayScore: 0,
      },
      {
        matchId: match1.id,
        period: 1,
        periodSeconds: 90,
        scoringTeamId: teams[1].id,
        homeScore: 1,
        awayScore: 1,
      },
      {
        matchId: match1.id,
        period: 1,
        periodSeconds: 130,
        scoringTeamId: teams[0].id,
        homeScore: 2,
        awayScore: 1,
      },
    ],
  });

  // Standings for the 2026 competition
  for (let i = 0; i < teams.length; i++) {
    await prisma.standing.create({
      data: {
        competitionId: comp2026.id,
        teamId: teams[i].id,
        rank: i + 1,
        played: i < 4 ? 2 : 1,
        wins: i < 2 ? 2 : i < 4 ? 1 : 0,
        losses: i < 2 ? 0 : i < 4 ? 1 : i < 6 ? 1 : 0,
        draws: 0,
        goalsFor: 120 - i * 8,
        goalsAgainst: 100 + i * 3,
        goalPercentage: parseFloat(
          (((120 - i * 8) / (100 + i * 3)) * 100).toFixed(1)
        ),
        points: i < 2 ? 8 : i < 4 ? 4 : 0,
      },
    });
  }

  console.log("Seed completed.");
  console.log(`  Competitions: 2`);
  console.log(`  Teams: ${teams.length}`);
  console.log(`  Players: ${allPlayers.length}`);
  console.log(`  Matches: 4 (2 completed, 1 live, 1 scheduled)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
