import type { DataCapability, Position } from '@prisma/client';
import { ALL_DATA_CAPABILITIES } from '@/lib/sources/coverage';
import type { ImportIssueInput, NormalizedCompetitionImport } from '@/lib/sources/types';

const POSITIONS = new Set<Position>(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
const CAPABILITIES = new Set<DataCapability>(ALL_DATA_CAPABILITIES);

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
  }
  for (const player of input.players) {
    required(issues, player.externalId, 'players.externalId', player.externalId);
    required(issues, player.teamExternalId, 'players.teamExternalId', player.externalId);
    if (!POSITIONS.has(player.position)) {
      issues.push({ severity: 'ERROR', code: 'INVALID_POSITION', message: `Invalid position: ${player.position}`, externalId: player.externalId, fieldPath: 'players.position' });
    }
  }
  for (const match of input.matches) {
    required(issues, match.externalId, 'matches.externalId', match.externalId);
    required(issues, match.stageSlug, 'matches.stageSlug', match.externalId);
    if (Number.isNaN(new Date(match.scheduledAt).getTime())) {
      issues.push({ severity: 'ERROR', code: 'INVALID_DATETIME', message: 'Match scheduledAt must be an ISO date', externalId: match.externalId, fieldPath: 'matches.scheduledAt' });
    }
  }
  for (const item of input.coverage) {
    if (!CAPABILITIES.has(item.capability)) {
      issues.push({ severity: 'ERROR', code: 'INVALID_CAPABILITY', message: `Unknown capability: ${item.capability}`, fieldPath: 'coverage.capability' });
    }
  }
  return issues;
}
