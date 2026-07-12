export interface PlayerSearchResult {
  id: string;
  kind: 'player';
  label: string;
  meta: string;
  href: string;
}

export interface TeamSearchResult {
  id: string;
  kind: 'team';
  label: string;
  meta: string;
  href: string;
}

export interface MatchSearchResult {
  id: string;
  kind: 'match';
  label: string;
  meta: string;
  href: string;
}

export interface SearchResponse {
  players: PlayerSearchResult[];
  teams: TeamSearchResult[];
  matches: MatchSearchResult[];
}

export type SearchResult = PlayerSearchResult | TeamSearchResult | MatchSearchResult;
