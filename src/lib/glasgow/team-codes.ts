const OFFICIAL_TEAM_CODE_ALIASES: Readonly<Record<string, string>> = {
  // The source bundle uses ISO-style codes while the official feed uses
  // Commonwealth Games organisation codes for these two teams.
  MAW: 'MWI',
  TGA: 'TON',
};

export function canonicalGlasgowTeamCode(code: string): string {
  return OFFICIAL_TEAM_CODE_ALIASES[code] ?? code;
}
