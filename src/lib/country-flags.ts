interface TeamFlagIdentity {
  name: string;
  abbreviation: string;
}

const FLAG_BY_ABBREVIATION: Readonly<Record<string, string>> = {
  AUS: '/flags/glasgow-2026/au.svg',
  ENG: '/flags/glasgow-2026/gb-eng.svg',
  RSA: '/flags/glasgow-2026/za.svg',
  MWI: '/flags/glasgow-2026/mw.svg',
  TON: '/flags/glasgow-2026/to.svg',
  NIR: '/flags/glasgow-2026/gb-nir.svg',
  NZL: '/flags/glasgow-2026/nz.svg',
  JAM: '/flags/glasgow-2026/jm.svg',
  WAL: '/flags/glasgow-2026/gb-wls.svg',
  UGA: '/flags/glasgow-2026/ug.svg',
  SCO: '/flags/glasgow-2026/gb-sct.svg',
  TTO: '/flags/glasgow-2026/tt.svg',
};

const FLAG_BY_NAME: Readonly<Record<string, string>> = {
  australia: FLAG_BY_ABBREVIATION.AUS,
  england: FLAG_BY_ABBREVIATION.ENG,
  southafrica: FLAG_BY_ABBREVIATION.RSA,
  malawi: FLAG_BY_ABBREVIATION.MWI,
  tonga: FLAG_BY_ABBREVIATION.TON,
  northernireland: FLAG_BY_ABBREVIATION.NIR,
  newzealand: FLAG_BY_ABBREVIATION.NZL,
  jamaica: FLAG_BY_ABBREVIATION.JAM,
  wales: FLAG_BY_ABBREVIATION.WAL,
  uganda: FLAG_BY_ABBREVIATION.UGA,
  scotland: FLAG_BY_ABBREVIATION.SCO,
  trinidadandtobago: FLAG_BY_ABBREVIATION.TTO,
};

function normalizeTeamName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll('&', 'and')
    .replace(/[^a-z0-9]+/g, '');
}

/** Return a local SVG flag path only for known international teams. */
export function countryFlagForTeam(team: TeamFlagIdentity): string | null {
  const abbreviation = team.abbreviation.trim().toUpperCase();
  return FLAG_BY_ABBREVIATION[abbreviation]
    ?? FLAG_BY_NAME[normalizeTeamName(team.name)]
    ?? null;
}
