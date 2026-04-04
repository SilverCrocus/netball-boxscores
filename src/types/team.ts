/** Minimal team info shared across UI components (badges, score cards, etc.) */
export interface TeamInfo {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
}

/** TeamInfo with an ID — used when the component needs to identify the team */
export interface TeamInfoWithId extends TeamInfo {
  id: string;
}
