import type { DataCapability, MatchSlotSourceType, Position } from '@prisma/client';
import { ALL_DATA_CAPABILITIES } from '@/lib/sources/coverage';
import type { ImportIssueInput, NormalizedCompetitionImport } from '@/lib/sources/types';

const POSITIONS = new Set<Position>(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
const CAPABILITIES = new Set<DataCapability>(ALL_DATA_CAPABILITIES);
const SLOT_SOURCE_TYPES = new Set<MatchSlotSourceType>([
  'TEAM',
  'GROUP_RANK',
  'MATCH_WINNER',
  'MATCH_LOSER',
  'UNRESOLVED',
]);

function required(
  issues: ImportIssueInput[],
  value: unknown,
  fieldPath: string,
  externalId?: string
) {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push({ severity: 'ERROR', code: 'REQUIRED_FIELD', message: `${fieldPath} is required`, fieldPath, externalId });
  }
}

function duplicateIssues(
  issues: ImportIssueInput[],
  values: readonly string[],
  fieldPath: string
) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      issues.push({ severity: 'ERROR', code: 'DUPLICATE_EXTERNAL_ID', message: `Duplicate ${fieldPath}: ${value}`, fieldPath, externalId: value });
    }
    seen.add(value);
  }
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateNormalizedImport(input: NormalizedCompetitionImport): ImportIssueInput[] {
  const issues: ImportIssueInput[] = [];
  required(issues, input.context?.sourceKey, 'context.sourceKey');
  required(issues, input.context?.editionExternalId, 'context.editionExternalId');
  if (Number.isNaN(new Date(input.context?.retrievedAt).getTime())) {
    issues.push({ severity: 'ERROR', code: 'INVALID_DATETIME', message: 'context.retrievedAt must be an ISO date', fieldPath: 'context.retrievedAt' });
  }

  const collections = ['teams', 'players', 'rosters', 'matches', 'results', 'coverage'] as const;
  for (const collection of collections) {
    if (!Array.isArray(input[collection])) {
      issues.push({ severity: 'ERROR', code: 'INVALID_COLLECTION', message: `${collection} must be an array`, fieldPath: collection });
      return issues;
    }
  }

  duplicateIssues(issues, input.teams.map((team) => team.externalId), 'teams.externalId');
  duplicateIssues(issues, input.players.map((player) => player.externalId), 'players.externalId');
  duplicateIssues(issues, input.matches.map((match) => match.externalId), 'matches.externalId');

  for (const team of input.teams) {
    required(issues, team.externalId, 'teams.externalId', team.externalId);
    required(issues, team.name, 'teams.name', team.externalId);
    required(issues, team.slug, 'teams.slug', team.externalId);
    required(issues, team.abbreviation, 'teams.abbreviation', team.externalId);
    if (team.seed !== undefined && (!Number.isInteger(team.seed) || team.seed < 1)) {
      issues.push({ severity: 'ERROR', code: 'INVALID_SEED', message: 'Team seed must be a positive integer', fieldPath: 'teams.seed', externalId: team.externalId });
    }
  }
  for (const player of input.players) {
    required(issues, player.externalId, 'players.externalId', player.externalId);
    required(issues, player.teamExternalId, 'players.teamExternalId', player.externalId);
    if (!POSITIONS.has(player.position)) {
      issues.push({ severity: 'ERROR', code: 'INVALID_POSITION', message: `Invalid position: ${player.position}`, externalId: player.externalId, fieldPath: 'players.position' });
    }
    if (player.photoUrl) {
      if (!validHttpUrl(player.photoUrl)) {
        issues.push({ severity: 'ERROR', code: 'INVALID_URL', message: 'Player photoUrl must be an HTTP(S) URL', externalId: player.externalId, fieldPath: 'players.photoUrl' });
      }
      if (!player.photoSourceUrl || !validHttpUrl(player.photoSourceUrl)) {
        issues.push({ severity: 'ERROR', code: 'MISSING_PHOTO_SOURCE', message: 'A sourced player photo requires its original HTTP(S) source page', externalId: player.externalId, fieldPath: 'players.photoSourceUrl' });
      }
      required(issues, player.photoLicense, 'players.photoLicense', player.externalId);
    }
    if (player.photoVerifiedAt && Number.isNaN(new Date(player.photoVerifiedAt).getTime())) {
      issues.push({ severity: 'ERROR', code: 'INVALID_DATETIME', message: 'Player photoVerifiedAt must be an ISO date', externalId: player.externalId, fieldPath: 'players.photoVerifiedAt' });
    }
  }
  for (const match of input.matches) {
    required(issues, match.externalId, 'matches.externalId', match.externalId);
    required(issues, match.stageSlug, 'matches.stageSlug', match.externalId);
    if (Number.isNaN(new Date(match.scheduledAt).getTime())) {
      issues.push({ severity: 'ERROR', code: 'INVALID_DATETIME', message: 'Match scheduledAt must be an ISO date', externalId: match.externalId, fieldPath: 'matches.scheduledAt' });
    }
    for (const [sideName, side] of [['sideA', match.sideA], ['sideB', match.sideB]] as const) {
      const sourceType = side.sourceType ?? (side.teamExternalId ? 'TEAM' : 'UNRESOLVED');
      if (!SLOT_SOURCE_TYPES.has(sourceType)) {
        issues.push({ severity: 'ERROR', code: 'INVALID_SLOT_SOURCE', message: `Unknown match slot source type: ${sourceType}`, externalId: match.externalId, fieldPath: `matches.${sideName}.sourceType` });
      } else if (sourceType === 'TEAM' && !side.teamExternalId) {
        issues.push({ severity: 'ERROR', code: 'MISSING_SLOT_TEAM', message: 'TEAM match slots require teamExternalId', externalId: match.externalId, fieldPath: `matches.${sideName}.teamExternalId` });
      } else if (sourceType === 'GROUP_RANK' && (!side.sourceGroupSlug || !Number.isInteger(side.sourceRank) || (side.sourceRank ?? 0) < 1)) {
        issues.push({ severity: 'ERROR', code: 'INVALID_GROUP_RANK_SLOT', message: 'GROUP_RANK match slots require a group slug and positive source rank', externalId: match.externalId, fieldPath: `matches.${sideName}` });
      } else if ((sourceType === 'MATCH_WINNER' || sourceType === 'MATCH_LOSER') && !side.sourceMatchExternalId) {
        issues.push({ severity: 'ERROR', code: 'MISSING_SOURCE_MATCH', message: `${sourceType} match slots require sourceMatchExternalId`, externalId: match.externalId, fieldPath: `matches.${sideName}.sourceMatchExternalId` });
      } else if (sourceType === 'UNRESOLVED' && !side.sourceLabel) {
        issues.push({ severity: 'ERROR', code: 'MISSING_SLOT_LABEL', message: 'UNRESOLVED match slots require a display label', externalId: match.externalId, fieldPath: `matches.${sideName}.sourceLabel` });
      }
    }
  }
  for (const item of input.coverage) {
    if (!CAPABILITIES.has(item.capability)) {
      issues.push({ severity: 'ERROR', code: 'INVALID_CAPABILITY', message: `Unknown capability: ${item.capability}`, fieldPath: 'coverage.capability' });
    }
  }
  return issues;
}
