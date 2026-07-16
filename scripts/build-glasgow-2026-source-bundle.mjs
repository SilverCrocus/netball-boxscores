import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const retrievedAt = '2026-07-16T04:15:40.000Z';
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
  ['ENG', 'Halimat Adio', 'GK'],
  ['ENG', 'Francesca Williams', 'GD', true],
  ['ENG', 'Funmi Fadoju', 'WD'],
  ['ENG', 'Jayda Pechová', 'GK'],
  ['ENG', 'Imogen Allison', 'WD'],
  ['ENG', 'Jess Shaw', 'WA'],
  ['ENG', 'Amy Carter', 'C'],
  ['ENG', 'Natalie Metcalf', 'GA'],
  ['ENG', 'Sasha Glasgow', 'GS'],
  ['ENG', 'Olivia Tchine', 'GS'],
  ['ENG', 'Eleanor Cardwell', 'GS'],
  ['ENG', 'Lois Pearson', 'GA'],
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
  ['WAL', 'Philippa Yarranton', 'GA'],
];

const slugify = (value) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const photoEvidence = {
  'ENG-funmi-fadoju': {
    photoUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/England%20Netball%20player%20Funmi%20Fadoju.jpg',
    photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Funmi_Fadoju.jpg',
    photoCredit: 'Amy Martin Photography',
    photoLicense: 'CC BY-SA 4.0',
    photoVerifiedAt: retrievedAt,
  },
  'ENG-olivia-tchine': {
    photoUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/England%20Netball%20player%20Olivia%20Tchine.jpg',
    photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Olivia_Tchine.jpg',
    photoCredit: 'Amy Martin Photography',
    photoLicense: 'CC BY-SA 4.0',
    photoVerifiedAt: retrievedAt,
  },
  'ENG-eleanor-cardwell': {
    photoUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Thunderbirds%20shooter%20Eleanor%20Cardwell.jpg',
    photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:Thunderbirds_shooter_Eleanor_Cardwell.jpg',
    photoCredit: 'トりン',
    photoLicense: 'CC BY-SA 4.0',
    photoVerifiedAt: retrievedAt,
  },
};

const players = squadRows.map(([teamExternalId, name, position]) => {
  const externalId = `${teamExternalId}-${slugify(name)}`;
  return {
    externalId,
    teamExternalId,
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

const matches = poolSchedule.map(([date, time, pool, sideA, sideB], index) => ({
  externalId: matchId(date, time, sideA, sideB),
  stageSlug: 'pool-stage',
  groupSlug: `pool-${pool.toLowerCase()}`,
  scheduledAt: localToUtc(date, time),
  venue: 'The Hydro',
  neutralVenue: true,
  round: index + 1,
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

matches.push(
  unresolvedMatch('2026-07-31-0900-classification-11-12', 'classification', '2026-07-31', '09:00', 'Classification Match 1 — 11th v 12th', '11th place after pool stage', '12th place after pool stage'),
  unresolvedMatch('2026-07-31-1100-classification-9-10', 'classification', '2026-07-31', '11:00', 'Classification Match 2 — 9th v 10th', '9th place after pool stage', '10th place after pool stage'),
  unresolvedMatch('2026-07-31-1400-classification-7-8', 'classification', '2026-07-31', '14:00', 'Classification Match 3 — 7th v 8th', '7th place after pool stage', '8th place after pool stage'),
  unresolvedMatch('2026-07-31-1600-classification-5-6', 'classification', '2026-07-31', '16:00', 'Classification Match 4 — 5th v 6th', '5th place after pool stage', '6th place after pool stage'),
  unresolvedMatch('2026-08-01-0900-semi-final-1', 'semi-finals', '2026-08-01', '09:00', 'Semi-final 1', 'Semi-finalist TBC', 'Semi-finalist TBC'),
  unresolvedMatch('2026-08-01-1300-semi-final-2', 'semi-finals', '2026-08-01', '13:00', 'Semi-final 2', 'Semi-finalist TBC', 'Semi-finalist TBC'),
  unresolvedMatch('2026-08-02-0900-bronze-medal', 'medal-matches', '2026-08-02', '09:00', 'Bronze medal match', 'Bronze-medal participant TBC', 'Bronze-medal participant TBC'),
  unresolvedMatch('2026-08-02-1300-gold-medal', 'medal-matches', '2026-08-02', '13:00', 'Gold medal match', 'Gold-medal participant TBC', 'Gold-medal participant TBC'),
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
  ['england-positions', 'https://www.englandnetball.co.uk/vitality-roses/current-squad/', 'England player positions'],
  ['england-jayda-position', 'https://www.englandnetball.co.uk/news/vitality-roses-squad-confirmed-for-jamaica-series/', 'Jayda Pechová position'],
  ['new-zealand-squad', 'https://www.silverferns.co.nz/silver-ferns/news/latest-news/new-zealand-netball-team-ready-for-glasgow-2026-commonwealth-games-challenge.html', 'New Zealand final squad identities and captain'],
  ['new-zealand-positions', 'https://www.silverferns.co.nz/silver-ferns/team/sf-squad.html', 'New Zealand player positions'],
  ['scotland-squad', 'https://www.glasgow2026.com/news/4528552/meet-the-12-thistles-headed-for-the-hydro', 'Scotland final squad identities and positions'],
  ['wales-squad', 'https://walesnetball.com/wales-netball-announces-team-wales-netball-squad-for-glasgow-2026/', 'Wales final squad announcement'],
  ['wales-squad-list-image', 'https://walesnetball.com/wp-content/uploads/2026/06/WALES-NETBALL_CWG-ANNOUNCEMENT-LIST-1.jpg', 'Wales final squad identities and positions'],
  ['australia-squad', 'https://netball.com.au/news/team-announced-contend-gold-glasgow', 'Australia final squad identities; positions absent'],
  ['south-africa-squad', 'https://netball-sa.org.za/netball-south-africa-and-sascoc-confirm-commonwealth-squad/', 'South Africa final squad identities; positions absent'],
  ['northern-ireland-squad', 'https://www.sportni.net/news/teamni-netball-squad-ready-to-shoot-their-shot-in-glasgow/', 'Northern Ireland final squad identities; positions incomplete'],
  ['funmi-photo', 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Funmi_Fadoju.jpg', 'Funmi Fadoju reusable photo and licence'],
  ['olivia-photo', 'https://commons.wikimedia.org/wiki/File:England_Netball_player_Olivia_Tchine.jpg', 'Olivia Tchine reusable photo and licence'],
  ['eleanor-photo', 'https://commons.wikimedia.org/wiki/File:Thunderbirds_shooter_Eleanor_Cardwell.jpg', 'Eleanor Cardwell reusable photo and licence'],
].map(([id, url, purpose]) => ({ id, url, purpose, retrievedAt, fetchStatus: 'VERIFIED' }));

const squadCoverage = {
  AUS: { identity: 'VERIFIED', positions: 'UNAVAILABLE', importedPlayers: 0, note: 'Final 12 announced; the fetched announcement did not state positions.' },
  ENG: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  RSA: { identity: 'VERIFIED', positions: 'UNAVAILABLE', importedPlayers: 0, note: 'Final 12 announced; the fetched announcement did not state positions.' },
  MWI: { identity: 'UNAVAILABLE', positions: 'UNAVAILABLE', importedPlayers: 0, note: 'Fetched reporting described a 16-player preliminary group, not the final travelling 12.' },
  TON: { identity: 'UNAVAILABLE', positions: 'UNAVAILABLE', importedPlayers: 0, note: 'No successfully fetched primary final-squad list.' },
  NIR: { identity: 'VERIFIED', positions: 'PARTIAL', importedPlayers: 0, note: 'Final 12 announced; positions were only stated for some players.' },
  NZL: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  JAM: { identity: 'UNAVAILABLE', positions: 'UNAVAILABLE', importedPlayers: 0, note: 'No successfully fetched primary final-squad list with reusable text.' },
  WAL: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  UGA: { identity: 'UNAVAILABLE', positions: 'UNAVAILABLE', importedPlayers: 0, note: 'No successfully fetched primary final-squad list.' },
  SCO: { identity: 'VERIFIED', positions: 'VERIFIED', importedPlayers: 12 },
  TTO: { identity: 'UNAVAILABLE', positions: 'UNAVAILABLE', importedPlayers: 0, note: 'The fetched delegation announcement did not expose the netball roster.' },
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
    matchCoverage: { total: 38, poolStage: 30, classification: 4, semiFinals: 2, medalMatches: 2, unresolvedSlots: 16 },
    squadPositionConvention: 'Where an official source listed multiple positions, the first listed position is the database primary position.',
    squadCoverage,
    photoCoverage: { verifiedReusablePhotos: 3, license: 'CC BY-SA 4.0', allOtherPlayers: 'UNAVAILABLE' },
    resultCoverage: 'UNAVAILABLE — the tournament has not started.',
    publicationStatusRequired: 'DRAFT',
  },
  sources,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, 'bundle.json'), bundleText);
await writeFile(path.join(outputDirectory, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
