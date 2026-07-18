import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const retrievedAt = '2026-07-17T13:45:48.000Z';
const outputDirectory = path.resolve('data/glasgow-2026/v1');

const teamRows = [
  ['AUS', 'Australia', 'australia', 'pool-a', 1],
  ['ENG', 'England', 'england', 'pool-a', 4],
  ['RSA', 'South Africa', 'south-africa', 'pool-a', 5],
  ['MWI', 'Malawi', 'malawi', 'pool-a', 8],
  ['TON', 'Tonga', 'tonga', 'pool-a', 9],
  ['NIR', 'Northern Ireland', 'northern-ireland', 'pool-a', 12],
  ['NZL', 'New Zealand', 'new-zealand', 'pool-b', 2],
  ['JAM', 'Jamaica', 'jamaica', 'pool-b', 3],
  ['WAL', 'Wales', 'wales', 'pool-b', 6],
  ['UGA', 'Uganda', 'uganda', 'pool-b', 7],
  ['SCO', 'Scotland', 'scotland', 'pool-b', 10],
  ['TTO', 'Trinidad & Tobago', 'trinidad-and-tobago', 'pool-b', 11],
];

const teams = teamRows.map(([externalId, name, slug, groupSlug, seed]) => ({
  externalId,
  name,
  slug,
  abbreviation: externalId,
  groupSlug,
  seed,
  status: 'ACTIVE',
}));

const squadRows = [
  ['AUS', 'Kiera Austin', 'GS'],
  ['AUS', 'Courtney Bruce', 'GK'],
  ['AUS', 'Sophie Dwyer', 'GS'],
  ['AUS', 'Sophie Garbin', 'GA'],
  ['AUS', 'Matilda Garrett', 'GD'],
  ['AUS', 'Georgie Horjus', 'WA'],
  ['AUS', 'Sarah Klau', 'GK'],
  ['AUS', 'Cara Koenen', 'GS'],
  ['AUS', 'Kate Moloney', 'C'],
  ['AUS', 'Jamie-Lee Price', 'WD'],
  ['AUS', 'Liz Watson', 'WA', true],
  ['AUS', 'Jo Weston', 'GK'],
  ['ENG', 'Halimat Adio', 'GK'],
  ['ENG', 'Francesca Williams', 'GD', true],
  ['ENG', 'Funmi Fadoju', 'GD'],
  ['ENG', 'Jayda Pechová', 'GK'],
  ['ENG', 'Imogen Allison', 'WD'],
  ['ENG', 'Jess Shaw', 'WA'],
  ['ENG', 'Amy Carter', 'C'],
  ['ENG', 'Natalie Metcalf', 'WA'],
  ['ENG', 'Sasha Glasgow', 'GA'],
  ['ENG', 'Olivia Tchine', 'GS'],
  ['ENG', 'Eleanor Cardwell', 'GS'],
  ['ENG', 'Lois Pearson', 'GA'],
  ['RSA', 'Khanyisa Chawane', 'WA', true],
  ['RSA', 'Jamie Golob', 'GD'],
  ['RSA', 'Kamogelo Maseko', 'GA'],
  ['RSA', 'Tarle Mathe', 'C'],
  ['RSA', 'Owethu Ngubane', 'GS'],
  ['RSA', 'Refiloe Nketsa', 'C'],
  ['RSA', 'Karla Pretorius', 'GD'],
  ['RSA', 'Nicola Smith', 'GD'],
  ['RSA', 'Rolene Streutker', 'GS'],
  ['RSA', 'Elmeré van der Berg', 'GS'],
  ['RSA', 'Karla Victor', 'C'],
  ['RSA', 'Sanmarie Visser', 'GD'],
  ['NIR', 'Lisa Bowman', 'GS'],
  ['NIR', 'Niamh Cooper', 'WD'],
  ['NIR', 'Frances Keenan', 'WA'],
  ['NIR', 'Emma Magee', 'GA'],
  ['NIR', 'Michelle Magee', 'GD', true],
  ['NIR', 'Maria McCann', 'GK'],
  ['NIR', 'Evelyn McCagherty', 'WA'],
  ['NIR', 'Georgie McGrath', 'GA'],
  ['NIR', 'Caroline O’Hanlon', 'C'],
  ['NIR', 'Orlaith Rogers', 'GS'],
  ['NIR', 'Fionnuala Toner', 'GD'],
  ['NIR', 'Lauren Walshe', 'GK'],
  ['NZL', 'Georgia Heffernan', 'GS'],
  ['NZL', 'Grace Nweke', 'GS'],
  ['NZL', 'Martina Salmon', 'GS'],
  ['NZL', 'Amelia Walmsley', 'GS'],
  ['NZL', 'Madeline Gordon', 'C'],
  ['NZL', 'Kate Heffernan', 'WD'],
  ['NZL', 'Kimiora Poi', 'C'],
  ['NZL', 'Mila Reuelu-Buchanan', 'C'],
  ['NZL', 'Karin Burger', 'GK', true],
  ['NZL', 'Catherine Hall', 'GK'],
  ['NZL', 'Kelly Jackson', 'GK'],
  ['NZL', 'Carys Stythe', 'GK'],
  ['JAM', 'Shamera Sterling-Humphrey', 'GK', true],
  ['JAM', 'Latanya Wilson', 'WD'],
  ['JAM', 'Shanice Beckford', 'GA'],
  ['JAM', 'Kadie-Ann Dehaney', 'GK'],
  ['JAM', 'Jodi-Ann Ward', 'GD'],
  ['JAM', 'Crystal Plummer', 'WD'],
  ['JAM', 'Nicole Dixon-Rochester', 'C'],
  ['JAM', 'Brie Grierson', 'WA'],
  ['JAM', 'Abigale Sutherland', 'C'],
  ['JAM', 'Rhea Dixon', 'GA'],
  ['JAM', 'Azara Wilmot', 'GS'],
  ['JAM', 'Romelda Aiken-George', 'GS'],
  ['SCO', 'Emma Barrie', 'GS'],
  ['SCO', 'Cerys Cairns', 'GA'],
  ['SCO', 'Iona Christian', 'WA'],
  ['SCO', 'Rachel Conway', 'GK'],
  ['SCO', 'Cerys Finn', 'GK'],
  ['SCO', 'Lexy Gillies', 'C'],
  ['SCO', 'Bethan Goodwin', 'GS'],
  ['SCO', 'Hannah Grant', 'WD'],
  ['SCO', 'Hannah Leighton', 'C'],
  ['SCO', 'Niamh McCall', 'GA'],
  ['SCO', 'Jazmine Moore', 'WA'],
  ['SCO', 'Emily Nicholl', 'GD'],
  ['WAL', 'Vicky Booth', 'C'],
  ['WAL', 'Bethan Dyke', 'WA'],
  ['WAL', 'Alex Johnson', 'GK'],
  ['WAL', 'Nansi Kuti', 'GS'],
  ['WAL', 'Zoe Matthewman', 'GA'],
  ['WAL', 'Leah Middleton', 'GK'],
  ['WAL', 'Caris Morgan', 'GD'],
  ['WAL', 'Megan Pilkington', 'C'],
  ['WAL', 'Georgia Rowe', 'GS'],
  ['WAL', 'Poppy Tydeman', 'WD'],
  ['WAL', 'Lowri Windsor', 'WA'],
  ['WAL', 'Phillipa Yarranton', 'GA'],
];

const slugify = (value) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const photoEvidence = {
  'ENG-funmi-fadoju': {
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/34/England_Netball_player_Funmi_Fadoju.jpg',
    photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Funmi_Fadoju.jpg',
    photoCredit: 'Amy Martin Photography',
    photoLicense: 'CC BY-SA 4.0',
    photoVerifiedAt: retrievedAt,
  },
  'ENG-olivia-tchine': {
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6d/England_Netball_player_Olivia_Tchine.jpg',
    photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Olivia_Tchine.jpg',
    photoCredit: 'Amy Martin Photography',
    photoLicense: 'CC BY-SA 4.0',
    photoVerifiedAt: retrievedAt,
  },
  'ENG-eleanor-cardwell': {
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/4/4b/Thunderbirds_shooter_Eleanor_Cardwell.jpg',
    photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:Thunderbirds_shooter_Eleanor_Cardwell.jpg',
    photoCredit: 'トりン',
    photoLicense: 'CC BY-SA 4.0',
    photoVerifiedAt: retrievedAt,
  },
  'JAM-shamera-sterling-humphrey': {
    photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/d/d4/Thunderbirds_defender_Shamera_Sterling.jpg',
    photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:Thunderbirds_defender_Shamera_Sterling.jpg',
    photoCredit: 'トりン',
    photoLicense: 'CC BY-SA 4.0',
    photoVerifiedAt: retrievedAt,
  },
};

// Manually reviewed cross-source identities. These Champion Data IDs already
// exist in CentrePass and prevent an international roster from creating a
// second career profile for the same person. Unlisted names remain new players.
const canonicalChampionDataPlayerIds = {
  'AUS-kiera-austin': 1001708,
  'AUS-courtney-bruce': 80343,
  'AUS-sophie-dwyer': 1019169,
  'AUS-sophie-garbin': 1001711,
  'AUS-matilda-garrett': 1007301,
  'AUS-georgie-horjus': 1015271,
  'AUS-sarah-klau': 998404,
  'AUS-cara-koenen': 1001357,
  'AUS-liz-watson': 994224,
  'AUS-kate-moloney': 991901,
  'AUS-jamie-lee-price': 80701,
  'AUS-jo-weston': 80577,
  'ENG-imogen-allison': 1016601,
  'ENG-sasha-glasgow': 1007298,
  'NZL-grace-nweke': 1014724,
  'NZL-karin-burger': 998411,
  'NZL-kate-heffernan': 1006758,
  'NZL-kelly-jackson': 993041,
  'JAM-jodi-ann-ward': 1011747,
  'JAM-kadie-ann-dehaney': 1001920,
  'JAM-latanya-wilson': 1019205,
  'JAM-romelda-aiken-george': 80078,
  'JAM-shamera-sterling-humphrey': 80830,
};

const players = squadRows.map(([teamExternalId, name, position]) => {
  const externalId = `${teamExternalId}-${slugify(name)}`;
  return {
    externalId,
    teamExternalId,
    ...(canonicalChampionDataPlayerIds[externalId]
      ? { canonicalChampionDataPlayerId: canonicalChampionDataPlayerIds[externalId] }
      : {}),
    name,
    position,
    ...photoEvidence[externalId],
  };
});

const rosters = squadRows.map(([teamExternalId, name, , isCaptain = false]) => ({
  teamExternalId,
  playerExternalId: `${teamExternalId}-${slugify(name)}`,
  status: 'ACTIVE',
  isCaptain,
}));

const unimportedSquadEvidence = {
  MWI: {
    status: 'FINAL',
    members: [
      'Takondwa Lwazi', 'Martha Dambo', 'Mphatso Banda', 'Aisha Gama',
      'Florence Jeke', 'Ethel Ng’ambi', 'Sophilet Banda', 'Tendai Masamba',
      'Mwai Kumwenda', 'Stella Matelezi', 'Melia Soko', 'Shabel Bengo',
    ],
    note: 'Final 12 identities are verified. The source set does not establish one exact primary bib for every player, so the roster is retained as evidence rather than imported with invented positions.',
  },
  TON: {
    status: 'FINAL',
    members: [
      'Alice Cocker', 'Emma Mateo', 'Halaevalu Toutaiolepo', 'Hulita Veve',
      'Isabella Fainga’anuku', 'Kalolaine Luana Aukafolau', 'Lavinia Lavea',
      'Leila Tu’inukuafe', 'Marie Payn', 'ʻOtolose Fainga’anuku', 'Sovika Pousini',
      'Uneeq Palavi',
    ],
    note: 'Final 12 identities are verified. Exact primary positions were not available for every player in the fetched source set.',
  },
  TTO: {
    status: 'FINAL',
    members: [
      'Janeisha Cassimy', 'Joelisa Cooper', 'Nichola Gill', 'Makayla Grant',
      'Demisha Henry', 'Aneisha Hyles', 'Shian Lewis', 'Adannaya Martin',
      'Jeresia McEachrane', 'Shaniya Morgan', 'Afeisha Noel', 'Ebony Williams',
    ],
    note: 'Final 12 identities are verified. Exact primary positions were not available for every player in the fetched source set.',
  },
  UGA: {
    status: 'PROVISIONAL',
    members: [
      'Mary Cholhok', 'Shadiah Nassanga', 'Rachael Nanyonga', 'Alice Isoto',
      'Margaret Baagala', 'Lillian Achola', 'Joan Ryekoboth', 'Mercy Batamuliza',
      'Hindu Namutebi', 'Shaffie Nalwanja', 'Stella Nanfuka', 'Mutesi Nassim',
      'Gloria Aya', 'Christine Nakitto', 'Haniisha Muhameed',
    ],
    note: 'This is the published 15-player preparation squad, not a final registered 12. No Uganda players are imported until a final squad is published.',
  },
};

const squadMembers = Object.fromEntries(teamRows.map(([teamExternalId]) => {
  const importedMembers = squadRows
    .filter(([rowTeamExternalId]) => rowTeamExternalId === teamExternalId)
    .map(([, name, position, isCaptain = false]) => ({ name, position, isCaptain }));
  const evidence = unimportedSquadEvidence[teamExternalId];
  return [teamExternalId, evidence ?? { status: 'FINAL', members: importedMembers }];
}));

const poolSchedule = [
  ['2026-07-25', '09:00', 'B', 'NZL', 'SCO'], ['2026-07-25', '11:00', 'A', 'AUS', 'TON'],
  ['2026-07-25', '14:00', 'A', 'ENG', 'NIR'], ['2026-07-25', '16:00', 'B', 'WAL', 'UGA'],
  ['2026-07-25', '19:00', 'B', 'JAM', 'TTO'], ['2026-07-25', '21:00', 'A', 'RSA', 'MWI'],
  ['2026-07-26', '09:00', 'B', 'WAL', 'SCO'], ['2026-07-26', '11:00', 'A', 'AUS', 'ENG'],
  ['2026-07-26', '14:00', 'A', 'MWI', 'NIR'], ['2026-07-26', '16:00', 'A', 'RSA', 'TON'],
  ['2026-07-26', '19:00', 'B', 'UGA', 'TTO'], ['2026-07-26', '21:00', 'B', 'NZL', 'JAM'],
  ['2026-07-27', '14:00', 'A', 'ENG', 'MWI'], ['2026-07-27', '16:00', 'A', 'TON', 'NIR'],
  ['2026-07-27', '19:00', 'B', 'JAM', 'UGA'], ['2026-07-27', '21:00', 'B', 'SCO', 'TTO'],
  ['2026-07-28', '14:00', 'A', 'RSA', 'NIR'], ['2026-07-28', '16:00', 'B', 'WAL', 'TTO'],
  ['2026-07-28', '19:00', 'B', 'NZL', 'UGA'], ['2026-07-28', '21:00', 'A', 'AUS', 'MWI'],
  ['2026-07-29', '14:00', 'B', 'JAM', 'SCO'], ['2026-07-29', '16:00', 'A', 'ENG', 'TON'],
  ['2026-07-29', '19:00', 'B', 'NZL', 'WAL'], ['2026-07-29', '21:00', 'A', 'AUS', 'RSA'],
  ['2026-07-30', '09:00', 'A', 'MWI', 'TON'], ['2026-07-30', '11:00', 'B', 'UGA', 'SCO'],
  ['2026-07-30', '14:00', 'B', 'NZL', 'TTO'], ['2026-07-30', '16:00', 'A', 'AUS', 'NIR'],
  ['2026-07-30', '19:00', 'B', 'JAM', 'WAL'], ['2026-07-30', '21:00', 'A', 'ENG', 'RSA'],
];

const localToUtc = (date, time) => new Date(`${date}T${time}:00+01:00`).toISOString();
const matchId = (date, time, sideA, sideB) => `${date}-${time.replace(':', '')}-${sideA.toLowerCase()}-${sideB.toLowerCase()}`;

const matches = poolSchedule.map(([date, time, pool, sideA, sideB]) => ({
  externalId: matchId(date, time, sideA, sideB),
  stageSlug: 'pool-stage',
  groupSlug: `pool-${pool.toLowerCase()}`,
  scheduledAt: localToUtc(date, time),
  venue: 'The Hydro',
  neutralVenue: true,
  roundLabel: `Pool ${pool} — ${date}`,
  status: 'SCHEDULED',
  sideA: { sourceType: 'TEAM', teamExternalId: sideA },
  sideB: { sourceType: 'TEAM', teamExternalId: sideB },
}));

const unresolvedMatch = (externalId, stageSlug, date, time, roundLabel, sideALabel, sideBLabel) => ({
  externalId,
  stageSlug,
  scheduledAt: localToUtc(date, time),
  venue: 'The Hydro',
  neutralVenue: true,
  roundLabel,
  status: 'SCHEDULED',
  sideA: { sourceType: 'UNRESOLVED', sourceLabel: sideALabel },
  sideB: { sourceType: 'UNRESOLVED', sourceLabel: sideBLabel },
});

const dependentMatch = (externalId, date, time, roundLabel, sourceType, sideALabel, sideBLabel) => ({
  externalId,
  stageSlug: 'medal-matches',
  scheduledAt: localToUtc(date, time),
  venue: 'The Hydro',
  neutralVenue: true,
  roundLabel,
  status: 'SCHEDULED',
  sideA: {
    sourceType,
    sourceMatchExternalId: '2026-08-01-0900-semi-final-1',
    sourceLabel: sideALabel,
  },
  sideB: {
    sourceType,
    sourceMatchExternalId: '2026-08-01-1300-semi-final-2',
    sourceLabel: sideBLabel,
  },
});

matches.push(
  unresolvedMatch('2026-07-31-0900-classification-11-12', 'classification', '2026-07-31', '09:00', 'Classification Match 1 — 11th v 12th', '11th place after pool stage', '12th place after pool stage'),
  unresolvedMatch('2026-07-31-1100-classification-9-10', 'classification', '2026-07-31', '11:00', 'Classification Match 2 — 9th v 10th', '9th place after pool stage', '10th place after pool stage'),
  unresolvedMatch('2026-07-31-1400-classification-7-8', 'classification', '2026-07-31', '14:00', 'Classification Match 3 — 7th v 8th', '7th place after pool stage', '8th place after pool stage'),
  unresolvedMatch('2026-07-31-1600-classification-5-6', 'classification', '2026-07-31', '16:00', 'Classification Match 4 — 5th v 6th', '5th place after pool stage', '6th place after pool stage'),
  unresolvedMatch('2026-08-01-0900-semi-final-1', 'semi-finals', '2026-08-01', '09:00', 'Semi-final 1', 'Semi-finalist TBC', 'Semi-finalist TBC'),
  unresolvedMatch('2026-08-01-1300-semi-final-2', 'semi-finals', '2026-08-01', '13:00', 'Semi-final 2', 'Semi-finalist TBC', 'Semi-finalist TBC'),
  dependentMatch('2026-08-02-0900-bronze-medal', '2026-08-02', '09:00', 'Bronze medal match', 'MATCH_LOSER', 'Loser of Semi-final 1', 'Loser of Semi-final 2'),
  dependentMatch('2026-08-02-1300-gold-medal', '2026-08-02', '13:00', 'Gold medal match', 'MATCH_WINNER', 'Winner of Semi-final 1', 'Winner of Semi-final 2'),
);

const capabilities = [
  'FINAL_SCORE', 'PERIOD_SCORES', 'TEAM_BOX_SCORE', 'PLAYER_BOX_SCORE', 'SCORE_FLOW',
  'MATCH_EVENTS', 'SUBSTITUTIONS', 'NET_POINTS', 'SUPER_SHOTS', 'LINEUPS',
];

const bundle = {
  context: {
    sourceKey: 'glasgow-2026-public-data',
    editionExternalId: 'glasgow-2026',
    retrievedAt,
    sourceUrl: 'https://netball.sport/events-and-results/commonwealth-games/',
  },
  teams,
  players,
  rosters,
  matches,
  results: [],
  coverage: capabilities.map((capability) => ({
    capability,
    state: 'UNAVAILABLE',
    notes: 'Pre-tournament source bundle: results and match-performance data are not yet available.',
  })),
};

const sources = [
  ['glasgow-participants-pools', 'https://www.glasgow2026.com/news/4396719/world-s-top-12-nations-confirmed-for-netball-at-glasgow-2026', 'teams and qualification'],
  ['glasgow-match-schedule', 'https://www.glasgow2026.com/news/4406319/glasgow-2026-netball-match-schedule-announced', 'pools and headline schedule'],
  ['world-netball-hub', 'https://netball.sport/events-and-results/commonwealth-games/', 'complete match-by-match schedule and unresolved finals slots'],
  ['glasgow-event-schedule-v15', 'https://resources.cwg-qbr.pulselive.com/qbr-commonwealth-games/document/2026/07/13/8d784373-7f4e-45ba-8f94-3341a0e209da/CWG26-Event-ALL-SPORTS_V15.pdf', 'latest official session schedule and local-time declaration'],
  ['glasgow-sec-venue', 'https://www.glasgow2026.com/venues/sec', 'The Hydro venue'],
  ['commonwealth-qualification-system', 'https://commonwealthgames.com.au/wp-content/uploads/Netball_G2026-CWG-Qualification-System_FINAL.pdf', 'final squad registration deadline'],
  ['england-squad', 'https://www.teamengland.org/news/ready-to-score-team-england-confirm-netball-squad-for-glasgow-2026', 'England final squad identities and captain'],
  ['england-positions', 'https://londonpulsenetball.com/nsl-rd-1-match-report-london-pulse-vs-manchester-thunder/', 'Halimat Adio, Funmi Fadoju, Imogen Allison, Amy Carter, Natalie Metcalf, Olivia Tchine and Lois Pearson positions'],
  ['england-jayda-position', 'https://teamengland.org/news/jayda-pechov-completes-the-ultimate-comeback-at-glasgow-2026', 'Jayda Pechová goal-keeper position'],
  ['england-francesca-position', 'https://teamengland.org/team-england-athletes/francesca-williams', 'Francesca Williams goal-defence position'],
  ['england-jess-position', 'https://teamengland.org/team-england-athletes/jess-shaw', 'Jess Shaw wing-attack position'],
  ['england-sasha-position', 'https://teamengland.org/team-england-athletes/sasha-glasgow', 'Sasha Glasgow goal-attack position'],
  ['england-eleanor-position', 'https://www.manchesterthunder.co.uk/welcome-back-eleanor-cardwell/', 'Eleanor Cardwell goal-shooter position'],
  ['new-zealand-squad', 'https://www.silverferns.co.nz/silver-ferns/news/latest-news/new-zealand-netball-team-ready-for-glasgow-2026-commonwealth-games-challenge.html', 'New Zealand final squad identities and captain'],
  ['new-zealand-positions', 'https://www.silverferns.co.nz/silver-ferns/team/sf-squad.html', 'New Zealand player positions'],
  ['scotland-squad', 'https://www.glasgow2026.com/news/4528552/meet-the-12-thistles-headed-for-the-hydro', 'Scotland final squad identities and positions'],
  ['wales-squad', 'https://walesnetball.com/wales-netball-announces-team-wales-netball-squad-for-glasgow-2026/', 'Wales final squad announcement'],
  ['wales-squad-list-image', 'https://walesnetball.com/wp-content/uploads/2026/06/WALES-NETBALL_CWG-ANNOUNCEMENT-LIST-1.jpg', 'Wales final squad identities and positions'],
  ['australia-squad', 'https://netball.com.au/news/team-announced-contend-gold-glasgow', 'Australia final squad identities and captain'],
  ['australia-positions', 'https://netball.com.au/diamonds/squad', 'Australia player positions'],
  ['south-africa-squad', 'https://netball-sa.org.za/netball-south-africa-and-sascoc-confirm-commonwealth-squad/', 'South Africa final squad identities and captain'],
  ['south-africa-positions', 'https://netball-sa.org.za/spar-proteas/', 'South Africa player positions'],
  ['south-africa-crinums-positions', 'https://netball-sa.org.za/telkom-netball-league-2026/crinums/', 'Karla Pretorius and Karla Victor positions'],
  ['northern-ireland-squad', 'https://www.sportni.net/news/teamni-netball-squad-ready-to-shoot-their-shot-in-glasgow/', 'Northern Ireland final squad identities and captain'],
  ['northern-ireland-positions', 'https://netballni.org/warriors-pathway/squad/warriors/', 'Northern Ireland player positions'],
  ['northern-ireland-lisa-position', 'https://www.glasgow2026.com/news/4507814/northern-ireland-netball-trio-set-for-exciting-glasgow-return', 'Lisa Bowman goal-shooter role'],
  ['malawi-squad-hub', 'https://netball.sport/events-and-results/commonwealth-games/malawi/', 'Malawi final squad announcement embed'],
  ['malawi-squad-post', 'https://www.facebook.com/mncs.mw/posts/1845930406855161', 'Malawi National Council of Sports final squad graphic'],
  ['malawi-positions', 'https://mwnation.com/nam-announces-malawi-queens-commonwealth-games-squad/', 'Malawi preliminary positional groups'],
  ['tonga-squad-hub', 'https://netball.sport/events-and-results/commonwealth-games/tonga/', 'Tonga final squad announcement embed'],
  ['tonga-squad-post', 'https://www.facebook.com/tonganetball/posts/1469834128501258', 'Tonga Netball final squad graphic'],
  ['jamaica-squad-hub', 'https://netball.sport/events-and-results/commonwealth-games/jamaica/', 'Jamaica final squad announcement embed'],
  ['jamaica-squad-post', 'https://www.facebook.com/NetballJamaica/posts/1479327667570966', 'Netball Jamaica final squad graphic'],
  ['jamaica-squad-report', 'https://www.jamaicaobserver.com/2026/07/10/sunshine-girls-head-glasgow-gold-mind/', 'Jamaica final squad identities'],
  ['jamaica-position-guide', 'https://mcges.gov.jm/images/PDF/BIGUP_2023_SunshineGirls.pdf', 'Jamaica established player positions'],
  ['jamaica-new-player-positions', 'https://londonpulsenetball.com/academy-npl-season-complete-u17-u19-crowned-champions/', 'Azara Wilmot goal-shooter position'],
  ['jamaica-rhea-position', 'https://netballnz.co.nz/images/silver-ferns/documents/SFTJT-21-Media-Guide-web.pdf', 'Rhea Dixon goal-attack position'],
  ['jamaica-brie-position', 'https://londonpulsenetball.com/brie-grierson-back-in-pink-and-black/', 'Brie Grierson primary position'],
  ['jamaica-crystal-position', 'https://www.jamaicaobserver.com/2024/08/15/crystal-plummers-netball-future-shines-bright/', 'Crystal Plummer positions'],
  ['trinidad-tobago-squad-hub', 'https://netball.sport/events-and-results/commonwealth-games/trinidadtobago/', 'Trinidad and Tobago final squad announcement embed'],
  ['trinidad-tobago-squad-post', 'https://www.facebook.com/TTOCommonwealthGamesAssociation/posts/1682294542859642', 'TTO Commonwealth Games Association final delegation graphic'],
  ['uganda-provisional-squad', 'https://www.newvision.co.ug/category/sports/she-cranes-unveil-commonwealth-squad-line-up-NV_236303_062026', 'Uganda 15-player preparation squad; not a final 12'],
  ['funmi-photo', 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Funmi_Fadoju.jpg', 'Funmi Fadoju reusable photo and licence'],
  ['olivia-photo', 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Olivia_Tchine.jpg', 'Olivia Tchine reusable photo and licence'],
  ['eleanor-photo', 'https://commons.wikimedia.org/wiki/File:Thunderbirds_shooter_Eleanor_Cardwell.jpg', 'Eleanor Cardwell reusable photo and licence'],
  ['shamera-photo', 'https://commons.wikimedia.org/wiki/File:Thunderbirds_defender_Shamera_Sterling.jpg', 'Shamera Sterling-Humphrey reusable photo and licence'],
].map(([id, url, purpose]) => ({
  id,
  url,
  purpose,
  retrievedAt,
  // The bundle records the public source used for each fact, but does not
  // contain an immutable fetch receipt that would justify a VERIFIED claim.
  fetchStatus: 'REFERENCED',
}));

const squadCoverage = {
  AUS: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  ENG: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  RSA: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  MWI: { identity: 'VERIFIED', positions: 'PARTIAL', importedPlayers: 0, note: 'Final 12 identities retained in squadMembers; exact primary position is not supported for every member.' },
  TON: { identity: 'VERIFIED', positions: 'PARTIAL', importedPlayers: 0, note: 'Final 12 identities retained in squadMembers; exact primary position is not supported for every member.' },
  NIR: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12, note: 'Lauren Walshe is the canonical federation spelling; the final announcement rendered her first name as Laureen.' },
  NZL: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  JAM: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  WAL: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  UGA: { identity: 'PROVISIONAL', positions: 'PARTIAL', importedPlayers: 0, note: 'Published list contains 15 preparation-squad players, not a final registered 12.' },
  SCO: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  TTO: { identity: 'VERIFIED', positions: 'PARTIAL', importedPlayers: 0, note: 'Final 12 identities retained in squadMembers; exact primary position is not supported for every member.' },
};

const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
const bundleFileSha256 = createHash('sha256').update(bundleText).digest('hex');
const manifest = {
  schemaVersion: 1,
  bundleVersion: 'v1',
  edition: 'glasgow-2026',
  generatedAt: retrievedAt,
  bundleFile: 'bundle.json',
  bundleFileSha256,
  declarations: {
    sourceTimezone: 'Europe/London',
    scheduleLocalAbbreviation: 'BST',
    utcConversion: 'Every published BST time was stored with a +01:00 offset and serialized to UTC.',
    venue: 'The Hydro',
    matchCoverage: { total: 38, poolStage: 30, classification: 4, semiFinals: 2, medalMatches: 2, unresolvedSlots: 12, dependentSlots: 4 },
    squadPositionConvention: 'A database primary position is recorded only when a fetched source directly supports that player-position fact; no unsupported position is inferred for import completeness.',
    squadIdentityCoverage: { finalSquads: 11, provisionalSquads: 1, importedCompleteSquads: 8 },
    squadCoverage,
    squadMembers,
    photoCoverage: { verifiedReusablePhotos: 4, license: 'CC BY-SA 4.0', allOtherPlayers: 'UNAVAILABLE' },
    resultCoverage: 'UNAVAILABLE — the tournament has not started.',
    publicationStatusPolicy: 'DRAFT_ONLY',
    publicationBlockers: [],
    publicSurfacePolicy: {
      matchLabels: 'Use roundLabel first, then final code, numerical round, or stage name.',
      reusablePlayerPhotos: 'Show sourced reusable photos only on attributed player profiles; secondary thumbnails and Open Graph cards use initials.',
    },
    factualDataReuse: {
      basis: 'PUBLIC_FACTUAL_DATA_USER_ASSERTED',
      organiserApproval: 'NOT_CLAIMED',
    },
  },
  sources,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'bundle.json'), bundleText);
await writeFile(path.join(outputDirectory, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
