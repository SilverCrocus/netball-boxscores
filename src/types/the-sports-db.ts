// ───── TheSportsDB API Response types ─────

export interface TSDBTeamsResponse {
  teams: TSDBTeam[] | null;
}

export interface TSDBTeam {
  idTeam: string;
  strTeam: string;
  strTeamShort: string;
  strAlternate: string;
  strLeague: string;
  strBadge: string;     // URL to team badge/logo
  strBanner: string;    // URL to team banner image
  strDescriptionEN: string;
  strCountry: string;
  strStadium: string;
  strTeamJersey: string; // URL to jersey image
  strTeamFanart1: string;
  strTeamFanart2: string;
  strTeamFanart3: string;
}

export interface TSDBPlayersResponse {
  player: TSDBPlayer[] | null;
}

export interface TSDBPlayer {
  idPlayer: string;
  strPlayer: string;
  strPosition: string;
  strNationality: string;
  strThumb: string;     // URL to player photo (thumbnail)
  strCutout: string;    // URL to cutout image
  strRender: string;    // URL to render image
  dateBorn: string;
  strDescriptionEN: string;
  strTeam: string;
}
