import type {
  CoverageState,
  DataCapability,
  MatchStatus,
  Position,
  SourceEntityType,
} from '@prisma/client';

export interface SourceImportContext {
  sourceKey: string;
  editionExternalId: string;
  retrievedAt: string;
  sourceUrl?: string;
}

export interface NormalizedTeamInput {
  externalId: string;
  name: string;
  slug: string;
  abbreviation: string;
}

export interface NormalizedPlayerInput {
  externalId: string;
  teamExternalId: string;
  name: string;
  position: Position;
}

export interface NormalizedRosterInput {
  teamExternalId: string;
  playerExternalId: string;
  status?: 'ACTIVE' | 'REPLACED' | 'WITHDRAWN';
  bib?: string;
  isCaptain?: boolean;
}

export interface NormalizedMatchSideInput {
  teamExternalId?: string;
  sourceLabel?: string;
}

export interface NormalizedMatchInput {
  externalId: string;
  stageSlug: string;
  groupSlug?: string;
  scheduledAt: string;
  venue: string;
  neutralVenue: boolean;
  round?: number;
  roundLabel?: string;
  status?: MatchStatus;
  sideA: NormalizedMatchSideInput;
  sideB: NormalizedMatchSideInput;
}

export interface NormalizedPeriodScoreInput {
  period: number;
  sideAScore: number;
  sideBScore: number;
}

export interface NormalizedResultInput {
  matchExternalId: string;
  status: MatchStatus;
  sideAScore: number;
  sideBScore: number;
  periods?: NormalizedPeriodScoreInput[];
}

export interface NormalizedCoverageInput {
  capability: DataCapability;
  state: CoverageState;
  matchExternalId?: string;
  notes?: string;
}

export interface NormalizedCompetitionImport {
  context: SourceImportContext;
  teams: NormalizedTeamInput[];
  players: NormalizedPlayerInput[];
  rosters: NormalizedRosterInput[];
  matches: NormalizedMatchInput[];
  results: NormalizedResultInput[];
  coverage: NormalizedCoverageInput[];
}

export interface ImportIssueInput {
  severity: 'INFO' | 'WARNING' | 'ERROR';
  code: string;
  message: string;
  entityType?: SourceEntityType;
  externalId?: string;
  fieldPath?: string;
}

export type ProposedWriteOperation = 'INSERT' | 'UPDATE' | 'SKIP';

export interface ProposedWrite {
  operation: ProposedWriteOperation;
  target: string;
  externalId: string;
  identityKey: string;
  reason: string;
}

export interface UnresolvedIdentity {
  entityType: SourceEntityType;
  externalId: string;
  referencedBy: string;
}

export interface ImportPreview {
  checksum: string;
  valid: boolean;
  standingsStrategyKey: string;
  issues: ImportIssueInput[];
  unresolved: UnresolvedIdentity[];
  writes: ProposedWrite[];
  coverage: NormalizedCoverageInput[];
}

export interface ExistingSourceIdentity {
  entityType: SourceEntityType;
  externalId: string;
  internalEntityId: string;
}

export interface ImportPlanningContext {
  sourceSystemId: string;
  competitionId: string;
  existingIdentities: ExistingSourceIdentity[];
  knownStageSlugs: string[];
  standingsStrategyKey: string;
  allowUnresolvedMatches?: boolean;
}
