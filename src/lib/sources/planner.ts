import type { SourceEntityType } from '@prisma/client';
import { sourcePayloadChecksum } from '@/lib/sources/checksum';
import { completeCoverageMatrix } from '@/lib/sources/coverage';
import { sourceIdentityKey } from '@/lib/sources/identity';
import type {
  ImportPlanningContext,
  ImportPreview,
  NormalizedCompetitionImport,
  ProposedWrite,
  UnresolvedIdentity,
} from '@/lib/sources/types';
import { validateNormalizedImport } from '@/lib/sources/validation';

function mappingKey(entityType: SourceEntityType, externalId: string): string {
  return `${entityType}:${externalId}`;
}

export function planCompetitionImport(
  input: NormalizedCompetitionImport,
  context: ImportPlanningContext
): ImportPreview {
  const issues = validateNormalizedImport(input);
  if (!context.standingsStrategyKey.trim()) {
    issues.push({
      severity: 'ERROR',
      code: 'MISSING_STANDINGS_STRATEGY',
      message: 'The edition ruleset must select a standings strategy before import',
      fieldPath: 'ruleset.standingsStrategyKey',
    });
  }
  const existing = new Map(
    context.existingIdentities.map((identity) => [
      mappingKey(identity.entityType, identity.externalId),
      identity,
    ])
  );
  const incomingTeams = new Set(input.teams.map((team) => team.externalId));
  const incomingPlayers = new Set(input.players.map((player) => player.externalId));
  const incomingMatches = new Set(input.matches.map((match) => match.externalId));
  const known = (entityType: SourceEntityType, externalId: string) =>
    existing.has(mappingKey(entityType, externalId));
  const unresolved: UnresolvedIdentity[] = [];
  const writes: ProposedWrite[] = [];

  const addWrite = (
    target: string,
    entityType: SourceEntityType,
    externalId: string,
    operation?: ProposedWrite['operation']
  ) => {
    const mapped = known(entityType, externalId);
    writes.push({
      operation: operation ?? (mapped ? 'UPDATE' : 'INSERT'),
      target,
      externalId,
      identityKey: sourceIdentityKey({
        sourceKey: input.context.sourceKey,
        editionExternalId: input.context.editionExternalId,
        entityType,
        externalId,
      }),
      reason: mapped ? 'Existing scoped source identity' : 'New scoped source identity',
    });
  };

  for (const team of input.teams) addWrite('TEAM', 'TEAM', team.externalId);
  for (const player of input.players) {
    if (!incomingTeams.has(player.teamExternalId) && !known('TEAM', player.teamExternalId)) {
      unresolved.push({ entityType: 'TEAM', externalId: player.teamExternalId, referencedBy: `player:${player.externalId}` });
    }
    addWrite('PLAYER', 'PLAYER', player.externalId);
  }
  for (const roster of input.rosters) {
    if (!incomingTeams.has(roster.teamExternalId) && !known('TEAM', roster.teamExternalId)) {
      unresolved.push({ entityType: 'TEAM', externalId: roster.teamExternalId, referencedBy: `roster:${roster.playerExternalId}` });
    }
    if (!incomingPlayers.has(roster.playerExternalId) && !known('PLAYER', roster.playerExternalId)) {
      unresolved.push({ entityType: 'PLAYER', externalId: roster.playerExternalId, referencedBy: `roster:${roster.teamExternalId}` });
    }
    writes.push({
      operation: 'UPDATE',
      target: 'ROSTER_MEMBERSHIP',
      externalId: `${roster.teamExternalId}:${roster.playerExternalId}`,
      identityKey: `${input.context.sourceKey}:${input.context.editionExternalId}:ROSTER:${roster.teamExternalId}:${roster.playerExternalId}`,
      reason: 'Idempotent roster upsert by edition entry and player',
    });
  }
  for (const match of input.matches) {
    if (!context.knownStageSlugs.includes(match.stageSlug)) {
      unresolved.push({ entityType: 'STAGE', externalId: match.stageSlug, referencedBy: `match:${match.externalId}` });
    }
    for (const [side, value] of [['A', match.sideA], ['B', match.sideB]] as const) {
      if (value.teamExternalId) {
        if (!incomingTeams.has(value.teamExternalId) && !known('TEAM', value.teamExternalId)) {
          unresolved.push({ entityType: 'TEAM', externalId: value.teamExternalId, referencedBy: `match:${match.externalId}:side${side}` });
        }
      } else if (!context.allowUnresolvedMatches) {
        unresolved.push({ entityType: 'TEAM', externalId: value.sourceLabel ?? 'UNRESOLVED', referencedBy: `match:${match.externalId}:side${side}` });
      }
    }
    addWrite('MATCH', 'MATCH', match.externalId);
  }
  for (const result of input.results) {
    if (!incomingMatches.has(result.matchExternalId) && !known('MATCH', result.matchExternalId)) {
      unresolved.push({ entityType: 'MATCH', externalId: result.matchExternalId, referencedBy: 'result' });
    }
    writes.push({
      operation: 'UPDATE',
      target: 'MATCH_RESULT',
      externalId: result.matchExternalId,
      identityKey: `${input.context.sourceKey}:${input.context.editionExternalId}:RESULT:${result.matchExternalId}`,
      reason: 'Result upsert by scoped match identity',
    });
  }

  const coverage = completeCoverageMatrix(input.coverage);
  for (const item of coverage) {
    if (item.matchExternalId && !incomingMatches.has(item.matchExternalId) && !known('MATCH', item.matchExternalId)) {
      unresolved.push({ entityType: 'MATCH', externalId: item.matchExternalId, referencedBy: `coverage:${item.capability}` });
    }
    writes.push({
      operation: 'UPDATE',
      target: 'DATA_COVERAGE',
      externalId: item.matchExternalId ? `${item.matchExternalId}:${item.capability}` : item.capability,
      identityKey: `${input.context.sourceKey}:${input.context.editionExternalId}:COVERAGE:${item.matchExternalId ?? 'edition'}:${item.capability}`,
      reason: item.state === 'UNAVAILABLE' ? 'Explicitly disable missing source capability' : 'Upsert declared source capability',
    });
  }

  for (const identity of unresolved) {
    issues.push({
      severity: 'ERROR',
      code: 'UNRESOLVED_IDENTITY',
      message: `${identity.entityType} ${identity.externalId} referenced by ${identity.referencedBy} could not be resolved`,
      entityType: identity.entityType,
      externalId: identity.externalId,
    });
  }

  return {
    checksum: sourcePayloadChecksum(input),
    valid: !issues.some((issue) => issue.severity === 'ERROR'),
    standingsStrategyKey: context.standingsStrategyKey,
    issues,
    unresolved,
    writes: writes.toSorted((left, right) => left.identityKey.localeCompare(right.identityKey)),
    coverage,
  };
}
