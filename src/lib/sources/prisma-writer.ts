import { randomUUID } from 'node:crypto';
import type {
  ImportMutationOperation,
  ImportMutationTarget,
  MatchSide,
  MatchSlotSourceType,
  Player,
  PublicationStatus,
  Prisma,
  PrismaClient,
  SourceEntityType,
} from '@prisma/client';
import type { CompetitionImportWriter, ImportExecutionReceipt } from '@/lib/sources/service';
import type {
  ImportPreview,
  NormalizedCompetitionImport,
  NormalizedMatchSideInput,
} from '@/lib/sources/types';

export interface PrismaCompetitionImportWriterOptions {
  sourceSystemId: string;
  competitionId: string;
  editionSourceId: string;
  trigger?: 'MANUAL' | 'SCHEDULED' | 'REPLAY';
  expectedPublicationStatus?: PublicationStatus;
  requireMatchingDryRun?: boolean;
  receiptMetadata?: Prisma.InputJsonObject;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function rowJson(value: object): Prisma.InputJsonObject {
  return jsonValue(value) as Prisma.InputJsonObject;
}

function slotSourceType(side: NormalizedMatchSideInput): MatchSlotSourceType {
  return side.sourceType ?? (side.teamExternalId ? 'TEAM' : 'UNRESOLVED');
}

function mappingKey(entityType: SourceEntityType, externalId: string): string {
  return `${entityType}:${externalId}`;
}

function normalizedPlayerName(name: string): string {
  return name.normalize('NFKD').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (isJsonObject(left) || isJsonObject(right)) {
    if (!isJsonObject(left) || !isJsonObject(right)) return false;
    const rightEntries = Object.entries(right);
    return Object.keys(left).length === rightEntries.length
      && rightEntries.every(([key, value]) => jsonValuesEqual(left[key], value));
  }
  return left === right;
}

function receiptMetadataMatches(
  metadata: Prisma.JsonValue | null,
  expected: Prisma.InputJsonObject | undefined,
): boolean {
  if (!expected) return true;
  if (!isJsonObject(metadata)) return false;
  return Object.entries(expected).every(([key, value]) =>
    jsonValuesEqual(metadata[key], value));
}

function importRunMetadata(
  options: PrismaCompetitionImportWriterOptions,
  preview: ImportPreview,
  extra: Record<string, unknown> = {},
): Prisma.InputJsonValue {
  return jsonValue({
    ...(options.receiptMetadata ?? {}),
    preview,
    ...extra,
  });
}

function completionTimestamp(startedAt: Date): Date {
  return new Date(Math.max(Date.now(), startedAt.getTime()));
}

export async function recordPrismaImportPreview(
  prisma: PrismaClient,
  options: PrismaCompetitionImportWriterOptions,
  input: NormalizedCompetitionImport,
  preview: ImportPreview,
): Promise<{ importRunId: string; checksum: string; publicationStatus: PublicationStatus }> {
  if (!preview.valid || preview.issues.length > 0 || preview.unresolved.length > 0) {
    throw new Error('Cannot record an unclean import preview');
  }

  return prisma.$transaction(async (transaction) => {
    const source = await transaction.sourceSystem.findUnique({
      where: { id: options.sourceSystemId },
    });
    if (!source || source.key !== input.context.sourceKey) {
      throw new Error(`Source system does not match import context: ${input.context.sourceKey}`);
    }
    const editionSource = await transaction.editionSource.findUnique({
      where: { id: options.editionSourceId },
    });
    if (
      !editionSource
      || editionSource.competitionId !== options.competitionId
      || editionSource.sourceSystemId !== source.id
      || editionSource.externalId !== input.context.editionExternalId
    ) {
      throw new Error('Edition source does not match the selected competition import context');
    }
    const competition = await transaction.competition.findUnique({
      where: { id: options.competitionId },
      select: { publicationStatus: true },
    });
    if (!competition) throw new Error(`Competition edition not found: ${options.competitionId}`);
    if (
      options.expectedPublicationStatus
      && competition.publicationStatus !== options.expectedPublicationStatus
    ) {
      throw new Error(
        `Import requires ${options.expectedPublicationStatus} edition status; found ${competition.publicationStatus}`,
      );
    }

    const importRunId = randomUUID();
    const recordedAt = new Date();
    await transaction.importRun.create({
      data: {
        id: importRunId,
        sourceSystemId: source.id,
        competitionId: options.competitionId,
        editionSourceId: editionSource.id,
        trigger: options.trigger ?? 'MANUAL',
        status: 'SUCCEEDED',
        dryRun: true,
        startedAt: recordedAt,
        retrievedAt: new Date(input.context.retrievedAt),
        completedAt: recordedAt,
        checksum: preview.checksum,
        issueCount: 0,
        metadata: importRunMetadata(options, preview, { previewRecorded: true }),
      },
    });

    return {
      importRunId,
      checksum: preview.checksum,
      publicationStatus: competition.publicationStatus,
    };
  }, {
    isolationLevel: 'Serializable',
    maxWait: 10_000,
    timeout: 30_000,
  });
}

/**
 * Persists a validated competition bundle into the canonical competition
 * tables in one serializable transaction. Source mappings make provider IDs
 * edition-scoped and repeatable; import runs, mutations, and snapshots retain
 * the provenance needed to audit every applied bundle.
 */
export class PrismaCompetitionImportWriter implements CompetitionImportWriter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaCompetitionImportWriterOptions
  ) {}

  async execute(
    input: NormalizedCompetitionImport,
    preview: ImportPreview
  ): Promise<ImportExecutionReceipt> {
    if (!preview.valid) throw new Error('Cannot execute an invalid import preview');

    const importRunId = randomUUID();
    const importStartedAt = new Date();
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const source = await transaction.sourceSystem.findUnique({
          where: { id: this.options.sourceSystemId },
        });
        if (!source || source.key !== input.context.sourceKey) {
          throw new Error(`Source system does not match import context: ${input.context.sourceKey}`);
        }

        const editionSource = await transaction.editionSource.findUnique({
          where: { id: this.options.editionSourceId },
        });
        if (
          !editionSource ||
          editionSource.competitionId !== this.options.competitionId ||
          editionSource.sourceSystemId !== source.id ||
          editionSource.externalId !== input.context.editionExternalId
        ) {
          throw new Error('Edition source does not match the selected competition import context');
        }
        const competition = await transaction.competition.findUnique({
          where: { id: this.options.competitionId },
          select: { publicationStatus: true },
        });
        if (!competition) {
          throw new Error(`Competition edition not found: ${this.options.competitionId}`);
        }
        if (
          this.options.expectedPublicationStatus
          && competition.publicationStatus !== this.options.expectedPublicationStatus
        ) {
          throw new Error(
            `Import requires ${this.options.expectedPublicationStatus} edition status; found ${competition.publicationStatus}`,
          );
        }

        if (this.options.requireMatchingDryRun) {
          const dryRunCandidates = await transaction.importRun.findMany({
            where: {
              sourceSystemId: source.id,
              competitionId: this.options.competitionId,
              checksum: preview.checksum,
              status: 'SUCCEEDED',
              dryRun: true,
              issueCount: 0,
            },
            orderBy: { completedAt: 'desc' },
            take: 20,
            select: { id: true, metadata: true },
          });
          const matchingDryRun = dryRunCandidates.find((candidate) =>
            receiptMetadataMatches(candidate.metadata, this.options.receiptMetadata));
          if (!matchingDryRun) {
            throw new Error(
              `Apply requires a recorded clean dry-run receipt with matching provenance for checksum ${preview.checksum}`,
            );
          }
        }

        const priorRunCandidates = await transaction.importRun.findMany({
          where: {
            sourceSystemId: source.id,
            competitionId: this.options.competitionId,
            checksum: preview.checksum,
            status: 'SUCCEEDED',
            dryRun: false,
          },
          orderBy: { completedAt: 'desc' },
          take: 20,
          select: { id: true, metadata: true },
        });
        const priorRun = priorRunCandidates.find((candidate) =>
          receiptMetadataMatches(candidate.metadata, this.options.receiptMetadata)) ?? null;

        await transaction.importRun.create({
          data: {
            id: importRunId,
            sourceSystemId: source.id,
            competitionId: this.options.competitionId,
            editionSourceId: editionSource.id,
            trigger: priorRun ? 'REPLAY' : (this.options.trigger ?? 'MANUAL'),
            status: 'RUNNING',
            dryRun: false,
            startedAt: importStartedAt,
            retrievedAt: new Date(input.context.retrievedAt),
            checksum: preview.checksum,
            issueCount: preview.issues.length,
            metadata: importRunMetadata(this.options, preview, {
              replayOfImportRunId: priorRun?.id ?? null,
            }),
          },
        });

        if (preview.issues.length > 0) {
          await transaction.importIssue.createMany({
            data: preview.issues.map((issue) => ({
              importRunId,
              severity: issue.severity,
              code: issue.code,
              entityType: issue.entityType,
              externalId: issue.externalId,
              fieldPath: issue.fieldPath,
              message: issue.message,
            })),
          });
        }

        const sourceMappings = await transaction.sourceEntityMapping.findMany({
          where: {
            sourceSystemId: source.id,
            competitionId: this.options.competitionId,
            entityType: { in: ['TEAM', 'PLAYER', 'MATCH'] },
          },
        });
        const mappingByIdentity = new Map(
          sourceMappings.map((mapping) => [mappingKey(mapping.entityType, mapping.externalId), mapping])
        );
        const reviewedCanonicalPlayers = new Map<string, Player>();
        for (const playerInput of input.players) {
          if (playerInput.canonicalChampionDataPlayerId === undefined) continue;

          const canonicalPlayer = await transaction.player.findUnique({
            where: { championDataPlayerId: playerInput.canonicalChampionDataPlayerId },
          });
          if (!canonicalPlayer) {
            throw new Error(
              `Reviewed canonical player was not found: ${playerInput.externalId}/${playerInput.canonicalChampionDataPlayerId}`,
            );
          }
          if (normalizedPlayerName(canonicalPlayer.name) !== normalizedPlayerName(playerInput.name)) {
            throw new Error(
              `Canonical player name mismatch: ${playerInput.externalId}/${canonicalPlayer.name}/${playerInput.name}`,
            );
          }

          const mapping = mappingByIdentity.get(mappingKey('PLAYER', playerInput.externalId));
          if (mapping && mapping.internalEntityId !== canonicalPlayer.id) {
            throw new Error(
              `Reviewed canonical player mapping mismatch: ${playerInput.externalId}/${mapping.internalEntityId}/${canonicalPlayer.id}`,
            );
          }
          if (priorRun && !mapping) {
            throw new Error(
              `Reviewed canonical player mapping is missing on replay: ${playerInput.externalId}/${canonicalPlayer.id}`,
            );
          }
          reviewedCanonicalPlayers.set(playerInput.externalId, canonicalPlayer);
        }

        if (priorRun) {
          await transaction.importRun.update({
            where: { id: importRunId },
            data: {
              status: 'SUCCEEDED',
              completedAt: completionTimestamp(importStartedAt),
              skippedCount: preview.writes.length,
            },
          });
          await transaction.editionSource.update({
            where: { id: editionSource.id },
            data: { lastSyncedAt: new Date(input.context.retrievedAt) },
          });
          return {
            importRunId,
            checksum: preview.checksum,
            inserted: 0,
            updated: 0,
            skipped: preview.writes.length,
            publicationStatus: competition.publicationStatus,
          };
        }

        let mutationSequence = 0;
        let insertedMutationCount = 0;
        let updatedMutationCount = 0;
        const recordMutation = async (
          target: ImportMutationTarget,
          entityId: string,
          operation: ImportMutationOperation,
          before: object | null,
          after: object
        ) => {
          mutationSequence++;
          if (operation === 'INSERT') insertedMutationCount++;
          if (operation === 'UPDATE') updatedMutationCount++;
          await transaction.importMutation.create({
            data: {
              importRunId,
              sequence: mutationSequence,
              operation,
              target,
              entityId,
              beforeData: before ? rowJson(before) : undefined,
              afterData: rowJson(after),
            },
          });
        };

        const stages = await transaction.stage.findMany({
          where: { competitionId: this.options.competitionId },
        });
        const stageBySlug = new Map(stages.map((stage) => [stage.slug, stage]));
        const groups = await transaction.stageGroup.findMany({
          where: { stage: { competitionId: this.options.competitionId } },
          include: { stage: { select: { slug: true } } },
        });
        const groupBySlug = new Map(groups.map((group) => [group.slug, group]));
        const upsertMapping = async (
          entityType: 'TEAM' | 'PLAYER' | 'MATCH',
          externalId: string,
          internalEntityId: string
        ) => {
          const key = mappingKey(entityType, externalId);
          const before = mappingByIdentity.get(key) ?? null;
          const metadata = jsonValue({
            sourceKey: input.context.sourceKey,
            editionExternalId: input.context.editionExternalId,
            lastChecksum: preview.checksum,
          });
          const after = before
            ? await transaction.sourceEntityMapping.update({
              where: { id: before.id },
              data: { internalEntityId, metadata, verifiedAt: new Date(input.context.retrievedAt) },
            })
            : await transaction.sourceEntityMapping.create({
              data: {
                sourceSystemId: source.id,
                competitionId: this.options.competitionId,
                entityType,
                externalId,
                internalEntityId,
                metadata,
                verifiedAt: new Date(input.context.retrievedAt),
              },
            });
          await recordMutation('SOURCE_ENTITY_MAPPING', after.id, before ? 'UPDATE' : 'INSERT', before, after);
          mappingByIdentity.set(key, after);
        };

        const teamIds = new Map<string, string>();
        const entryIds = new Map<string, string>();
        for (const teamInput of input.teams) {
          const mapping = mappingByIdentity.get(mappingKey('TEAM', teamInput.externalId));
          const before = mapping
            ? await transaction.team.findUnique({ where: { id: mapping.internalEntityId } })
            : await transaction.team.findFirst({
              where: { competitionId: this.options.competitionId, slug: teamInput.slug },
            });

          if (!before) {
            const slugOwner = await transaction.team.findUnique({ where: { slug: teamInput.slug } });
            if (slugOwner) {
              throw new Error(`Team slug is already used by another competition: ${teamInput.slug}`);
            }
          }

          const team = before
            ? await transaction.team.update({
              where: { id: before.id },
              data: {
                name: teamInput.name,
                slug: teamInput.slug,
                abbreviation: teamInput.abbreviation,
              },
            })
            : await transaction.team.create({
              data: {
                competitionId: this.options.competitionId,
                name: teamInput.name,
                slug: teamInput.slug,
                abbreviation: teamInput.abbreviation,
              },
            });
          await recordMutation('TEAM', team.id, before ? 'UPDATE' : 'INSERT', before, team);
          await upsertMapping('TEAM', teamInput.externalId, team.id);
          teamIds.set(teamInput.externalId, team.id);

          const group = teamInput.groupSlug ? groupBySlug.get(teamInput.groupSlug) : undefined;
          if (teamInput.groupSlug && !group) throw new Error(`Unknown team group: ${teamInput.groupSlug}`);
          const entryBefore = await transaction.editionEntry.findUnique({
            where: {
              competitionId_teamId: {
                competitionId: this.options.competitionId,
                teamId: team.id,
              },
            },
          });
          const entry = entryBefore
            ? await transaction.editionEntry.update({
              where: { id: entryBefore.id },
              data: {
                primaryGroupId: group?.id ?? null,
                seed: teamInput.seed,
                status: teamInput.status ?? 'ACTIVE',
                displayName: teamInput.name,
              },
            })
            : await transaction.editionEntry.create({
              data: {
                competitionId: this.options.competitionId,
                teamId: team.id,
                primaryGroupId: group?.id,
                seed: teamInput.seed,
                status: teamInput.status ?? 'ACTIVE',
                displayName: teamInput.name,
                enteredAt: new Date(input.context.retrievedAt),
              },
            });
          await recordMutation('EDITION_ENTRY', entry.id, entryBefore ? 'UPDATE' : 'INSERT', entryBefore, entry);
          entryIds.set(teamInput.externalId, entry.id);
        }

        const playerIds = new Map<string, string>();
        for (const playerInput of input.players) {
          const teamId = teamIds.get(playerInput.teamExternalId);
          if (!teamId) throw new Error(`Player team was not imported: ${playerInput.teamExternalId}`);
          const mapping = mappingByIdentity.get(mappingKey('PLAYER', playerInput.externalId));
          const mappedPlayer = mapping
            ? await transaction.player.findUnique({ where: { id: mapping.internalEntityId } })
            : null;
          const canonicalPlayer = reviewedCanonicalPlayers.get(playerInput.externalId) ?? null;
          const before = canonicalPlayer ?? mappedPlayer;
          const photoFields = {
            ...(playerInput.photoUrl !== undefined ? { photoUrl: playerInput.photoUrl } : {}),
            ...(playerInput.photoSourceUrl !== undefined ? { photoSourceUrl: playerInput.photoSourceUrl } : {}),
            ...(playerInput.photoCredit !== undefined ? { photoCredit: playerInput.photoCredit } : {}),
            ...(playerInput.photoLicense !== undefined ? { photoLicense: playerInput.photoLicense } : {}),
            ...(playerInput.photoVerifiedAt !== undefined
              ? { photoVerifiedAt: new Date(playerInput.photoVerifiedAt) }
              : {}),
          };
          const player = before
            ? await transaction.player.update({
              where: { id: before.id },
              // Team membership belongs to EditionEntry/RosterMembership. Keep
              // the legacy primary team/position on an existing canonical
              // player; edition-specific position lives on the roster row.
              data: {
                name: playerInput.name,
                ...((before.championDataPlayerId === null
                  || before.championDataPlayerId === undefined)
                  && playerInput.canonicalChampionDataPlayerId === undefined
                  ? { position: playerInput.position }
                  : {}),
                ...photoFields,
              },
            })
            : await transaction.player.create({
              data: { name: playerInput.name, position: playerInput.position, teamId, ...photoFields },
            });
          await recordMutation('PLAYER', player.id, before ? 'UPDATE' : 'INSERT', before, player);
          await upsertMapping('PLAYER', playerInput.externalId, player.id);
          playerIds.set(playerInput.externalId, player.id);
        }

        const existingActiveRosters = await transaction.rosterMembership.findMany({
          where: {
            editionEntry: { competitionId: this.options.competitionId },
            status: 'ACTIVE',
            validTo: null,
          },
          orderBy: { id: 'asc' },
        });
        const incomingRosterKeys = new Set<string>();
        const playerInputByExternalId = new Map(
          input.players.map((playerInput) => [playerInput.externalId, playerInput]),
        );
        for (const rosterInput of input.rosters) {
          const editionEntryId = entryIds.get(rosterInput.teamExternalId);
          const playerId = playerIds.get(rosterInput.playerExternalId);
          if (!editionEntryId || !playerId) {
            throw new Error(`Roster identities were not imported: ${rosterInput.teamExternalId}/${rosterInput.playerExternalId}`);
          }
          const designatedPosition = playerInputByExternalId.get(
            rosterInput.playerExternalId,
          )?.position;
          const before = await transaction.rosterMembership.findFirst({
            where: { editionEntryId, playerId, validTo: null },
            orderBy: { validFrom: 'desc' },
          });
          const roster = before
            ? await transaction.rosterMembership.update({
              where: { id: before.id },
              data: {
                status: rosterInput.status ?? 'ACTIVE',
                designatedPosition,
                bib: rosterInput.bib,
                isCaptain: rosterInput.isCaptain ?? false,
              },
            })
            : await transaction.rosterMembership.create({
              data: {
                editionEntryId,
                playerId,
                status: rosterInput.status ?? 'ACTIVE',
                validFrom: new Date(input.context.retrievedAt),
                designatedPosition,
                bib: rosterInput.bib,
                isCaptain: rosterInput.isCaptain ?? false,
              },
            });
          await recordMutation('ROSTER_MEMBERSHIP', roster.id, before ? 'UPDATE' : 'INSERT', before, roster);
          incomingRosterKeys.add(`${editionEntryId}:${playerId}`);
        }

        for (const staleRoster of existingActiveRosters) {
          if (incomingRosterKeys.has(`${staleRoster.editionEntryId}:${staleRoster.playerId}`)) {
            continue;
          }
          const closedRoster = await transaction.rosterMembership.update({
            where: { id: staleRoster.id },
            data: {
              status: 'REPLACED',
              validTo: new Date(input.context.retrievedAt),
              notes: 'Closed by complete source-snapshot reconciliation',
            },
          });
          await recordMutation(
            'ROSTER_MEMBERSHIP',
            closedRoster.id,
            'UPDATE',
            staleRoster,
            closedRoster,
          );
        }

        const matchIds = new Map<string, string>();
        for (const matchInput of input.matches) {
          const stage = stageBySlug.get(matchInput.stageSlug);
          if (!stage) throw new Error(`Unknown match stage: ${matchInput.stageSlug}`);
          const group = matchInput.groupSlug ? groupBySlug.get(matchInput.groupSlug) : undefined;
          if (matchInput.groupSlug && (!group || group.stageId !== stage.id)) {
            throw new Error(`Match group does not belong to stage ${matchInput.stageSlug}: ${matchInput.groupSlug}`);
          }
          const mapping = mappingByIdentity.get(mappingKey('MATCH', matchInput.externalId));
          const before = mapping
            ? await transaction.match.findUnique({ where: { id: mapping.internalEntityId } })
            : null;
          const homeTeamId = matchInput.sideA.teamExternalId
            ? teamIds.get(matchInput.sideA.teamExternalId)
            : undefined;
          const awayTeamId = matchInput.sideB.teamExternalId
            ? teamIds.get(matchInput.sideB.teamExternalId)
            : undefined;
          const match = before
            ? await transaction.match.update({
              where: { id: before.id },
              data: {
                stageId: stage.id,
                stageGroupId: group?.id ?? null,
                homeTeamId: homeTeamId ?? null,
                awayTeamId: awayTeamId ?? null,
                round: matchInput.round,
                roundLabel: matchInput.roundLabel,
                venue: matchInput.venue,
                neutralVenue: matchInput.neutralVenue,
                scheduledAt: new Date(matchInput.scheduledAt),
                status: matchInput.status ?? 'SCHEDULED',
                sourceRetrievedAt: new Date(input.context.retrievedAt),
              },
            })
            : await transaction.match.create({
              data: {
                competitionId: this.options.competitionId,
                stageId: stage.id,
                stageGroupId: group?.id,
                homeTeamId,
                awayTeamId,
                round: matchInput.round,
                roundLabel: matchInput.roundLabel,
                venue: matchInput.venue,
                neutralVenue: matchInput.neutralVenue,
                scheduledAt: new Date(matchInput.scheduledAt),
                status: matchInput.status ?? 'SCHEDULED',
                sourceRetrievedAt: new Date(input.context.retrievedAt),
              },
            });
          await recordMutation('MATCH', match.id, before ? 'UPDATE' : 'INSERT', before, match);
          await upsertMapping('MATCH', matchInput.externalId, match.id);
          matchIds.set(matchInput.externalId, match.id);
        }

        const persistSlot = async (
          matchId: string,
          sideName: MatchSide,
          sideInput: NormalizedMatchSideInput
        ) => {
          const sourceType = slotSourceType(sideInput);
          const resolvedEntryId = sideInput.teamExternalId
            ? entryIds.get(sideInput.teamExternalId)
            : undefined;
          const sourceGroupId = sideInput.sourceGroupSlug
            ? groupBySlug.get(sideInput.sourceGroupSlug)?.id
            : undefined;
          const sourceMatchId = sideInput.sourceMatchExternalId
            ? matchIds.get(sideInput.sourceMatchExternalId)
            : undefined;
          if (sourceType === 'TEAM' && !resolvedEntryId) throw new Error(`Unknown TEAM slot identity: ${sideInput.teamExternalId}`);
          if (sourceType === 'GROUP_RANK' && !sourceGroupId) throw new Error(`Unknown GROUP_RANK slot group: ${sideInput.sourceGroupSlug}`);
          if ((sourceType === 'MATCH_WINNER' || sourceType === 'MATCH_LOSER') && !sourceMatchId) {
            throw new Error(`Unknown source match slot identity: ${sideInput.sourceMatchExternalId}`);
          }
          const before = await transaction.matchSlot.findUnique({
            where: { matchId_side: { matchId, side: sideName } },
          });
          const slotData = {
            sourceType,
            resolvedEntryId: resolvedEntryId ?? null,
            sourceGroupId: sourceGroupId ?? null,
            sourceRank: sideInput.sourceRank ?? null,
            sourceMatchId: sourceMatchId ?? null,
            sourceLabel: sideInput.sourceLabel ?? null,
            resolvedAt: resolvedEntryId ? new Date(input.context.retrievedAt) : null,
          };
          const slot = before
            ? await transaction.matchSlot.update({ where: { id: before.id }, data: slotData })
            : await transaction.matchSlot.create({ data: { matchId, side: sideName, ...slotData } });
          await recordMutation('MATCH_SLOT', slot.id, before ? 'UPDATE' : 'INSERT', before, slot);
        };

        for (const matchInput of input.matches) {
          const matchId = matchIds.get(matchInput.externalId);
          if (!matchId) throw new Error(`Match was not imported: ${matchInput.externalId}`);
          await persistSlot(matchId, 'A', matchInput.sideA);
          await persistSlot(matchId, 'B', matchInput.sideB);
        }

        for (const resultInput of input.results) {
          const matchId = matchIds.get(resultInput.matchExternalId);
          if (!matchId) throw new Error(`Result match was not imported: ${resultInput.matchExternalId}`);
          const before = await transaction.match.findUniqueOrThrow({ where: { id: matchId } });
          const match = await transaction.match.update({
            where: { id: matchId },
            data: {
              status: resultInput.status,
              homeScore: resultInput.sideAScore,
              awayScore: resultInput.sideBScore,
              resultQuality: resultInput.status === 'COMPLETED' ? 'PROVISIONAL' : before.resultQuality,
              sourceUpdatedAt: new Date(input.context.retrievedAt),
            },
          });
          await recordMutation('MATCH', match.id, 'UPDATE', before, match);

          for (const period of resultInput.periods ?? []) {
            const quarterBefore = await transaction.matchQuarter.findUnique({
              where: { matchId_quarter: { matchId, quarter: period.period } },
            });
            const quarter = quarterBefore
              ? await transaction.matchQuarter.update({
                where: { id: quarterBefore.id },
                data: { homeScore: period.sideAScore, awayScore: period.sideBScore },
              })
              : await transaction.matchQuarter.create({
                data: {
                  matchId,
                  quarter: period.period,
                  homeScore: period.sideAScore,
                  awayScore: period.sideBScore,
                },
              });
            await recordMutation('MATCH_QUARTER', quarter.id, quarterBefore ? 'UPDATE' : 'INSERT', quarterBefore, quarter);
          }
        }

        for (const coverageInput of preview.coverage) {
          const matchId = coverageInput.matchExternalId
            ? matchIds.get(coverageInput.matchExternalId)
            : undefined;
          if (coverageInput.matchExternalId && !matchId) {
            throw new Error(`Coverage match was not imported: ${coverageInput.matchExternalId}`);
          }
          const before = await transaction.dataCoverage.findFirst({
            where: {
              competitionId: this.options.competitionId,
              matchId: matchId ?? null,
              capability: coverageInput.capability,
            },
          });
          const coverage = before
            ? await transaction.dataCoverage.update({
              where: { id: before.id },
              data: {
                sourceSystemId: source.id,
                state: coverageInput.state,
                observedAt: new Date(input.context.retrievedAt),
                notes: coverageInput.notes,
              },
            })
            : await transaction.dataCoverage.create({
              data: {
                competitionId: this.options.competitionId,
                matchId,
                sourceSystemId: source.id,
                capability: coverageInput.capability,
                state: coverageInput.state,
                observedAt: new Date(input.context.retrievedAt),
                notes: coverageInput.notes,
              },
            });
          await recordMutation('DATA_COVERAGE', coverage.id, before ? 'UPDATE' : 'INSERT', before, coverage);
        }

        const snapshotDedupeKey = `${source.id}:${this.options.competitionId}:${preview.checksum}`;
        const snapshot = await transaction.sourceSnapshot.findUnique({
          where: { dedupeKey: snapshotDedupeKey },
        });
        if (!snapshot) {
          await transaction.sourceSnapshot.create({
            data: {
              dedupeKey: snapshotDedupeKey,
              sourceSystemId: source.id,
              importRunId,
              competitionId: this.options.competitionId,
              entityType: 'COMPETITION_EDITION',
              externalId: input.context.editionExternalId,
              sourceUrl: input.context.sourceUrl,
              retrievedAt: new Date(input.context.retrievedAt),
              checksum: preview.checksum,
              rawPayload: source.rawPayloadStorageAllowed ? jsonValue(input) : undefined,
              metadata: jsonValue({
                ...(this.options.receiptMetadata ?? {}),
                teamCount: input.teams.length,
                playerCount: input.players.length,
                matchCount: input.matches.length,
              }),
            },
          });
        }

        const inserted = insertedMutationCount;
        const updated = updatedMutationCount;
        const skipped = 0;
        await transaction.importRun.update({
          where: { id: importRunId },
          data: {
            status: 'SUCCEEDED',
            completedAt: completionTimestamp(importStartedAt),
            insertedCount: inserted,
            updatedCount: updated,
            skippedCount: skipped,
          },
        });
        await transaction.editionSource.update({
          where: { id: editionSource.id },
          data: { lastSyncedAt: new Date(input.context.retrievedAt) },
        });

        return {
          importRunId,
          checksum: preview.checksum,
          inserted,
          updated,
          skipped,
          publicationStatus: competition.publicationStatus,
        };
      }, {
        isolationLevel: 'Serializable',
        maxWait: 10_000,
        // A full tournament bundle records audited mutations and snapshots in
        // one transaction. Remote preview/production databases can exceed
        // Prisma's five-second interactive-transaction default.
        timeout: 120_000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.prisma.importRun.create({
          data: {
            id: importRunId,
            sourceSystemId: this.options.sourceSystemId,
            competitionId: this.options.competitionId,
            editionSourceId: this.options.editionSourceId,
            trigger: this.options.trigger ?? 'MANUAL',
            status: 'FAILED',
            dryRun: false,
            startedAt: importStartedAt,
            retrievedAt: new Date(input.context.retrievedAt),
            completedAt: completionTimestamp(importStartedAt),
            checksum: preview.checksum,
            issueCount: preview.issues.length,
            errorMessage: message,
            metadata: importRunMetadata(this.options, preview),
          },
        });
      } catch {
        // Preserve the original import failure if even the failure receipt cannot be stored.
      }
      throw error;
    }
  }

  async rollback(importRunId: string): Promise<void> {
    const run = await this.prisma.importRun.findUnique({ where: { id: importRunId } });
    if (!run) throw new Error(`Import run not found: ${importRunId}`);
    if (run.status === 'ROLLED_BACK') return;
    throw new Error(
      'Automatic canonical rollback is intentionally disabled; review the stored ImportMutation rows before applying a compensating import'
    );
  }
}

export interface PrismaImportPlanningState {
  existingIdentities: Array<{
    entityType: SourceEntityType;
    externalId: string;
    internalEntityId: string;
  }>;
  knownStageSlugs: string[];
  knownGroupSlugs: string[];
  standingsStrategyKey: string;
}

export async function loadPrismaImportPlanningState(
  prisma: PrismaClient,
  input: { sourceSystemId: string; competitionId: string }
): Promise<PrismaImportPlanningState> {
  const [mappings, stages, groups, competition] = await Promise.all([
    prisma.sourceEntityMapping.findMany({
      where: {
        sourceSystemId: input.sourceSystemId,
        competitionId: input.competitionId,
      },
      select: { entityType: true, externalId: true, internalEntityId: true },
    }),
    prisma.stage.findMany({
      where: { competitionId: input.competitionId },
      select: { slug: true },
    }),
    prisma.stageGroup.findMany({
      where: { stage: { competitionId: input.competitionId } },
      select: { slug: true },
    }),
    prisma.competition.findUnique({
      where: { id: input.competitionId },
      select: { ruleset: { select: { standingsStrategyKey: true } } },
    }),
  ]);
  const standingsStrategyKey = competition?.ruleset?.standingsStrategyKey;
  if (!standingsStrategyKey) throw new Error('Competition ruleset has no standings strategy');
  return {
    existingIdentities: mappings,
    knownStageSlugs: stages.map((stage) => stage.slug),
    knownGroupSlugs: groups.map((group) => group.slug),
    standingsStrategyKey,
  };
}
