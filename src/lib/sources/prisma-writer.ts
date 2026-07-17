import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type DataCoverage,
  type EditionEntry,
  type ImportMutationOperation,
  type ImportMutationTarget,
  type Match,
  type MatchQuarter,
  type MatchSide,
  type MatchSlot,
  type MatchSlotSourceType,
  type Player,
  type PublicationStatus,
  type PrismaClient,
  type RosterMembership,
  type SourceEntityMapping,
  type SourceEntityType,
  type Team,
} from '@prisma/client';
import type { CompetitionImportWriter, ImportExecutionReceipt } from '@/lib/sources/service';
import { sourcePayloadChecksum } from '@/lib/sources/checksum';
import type {
  ImportPreview,
  NormalizedCompetitionImport,
  NormalizedMatchSideInput,
} from '@/lib/sources/types';
import { validateNormalizedImport } from '@/lib/sources/validation';

type CoverageSourcePrecedence = 'REQUIRE_SAME_SOURCE' | 'INCOMING_SOURCE';

export interface PrismaCompetitionImportWriterOptions {
  sourceSystemId: string;
  competitionId: string;
  editionSourceId: string;
  trigger?: 'MANUAL' | 'SCHEDULED' | 'REPLAY';
  expectedPublicationStatus?: PublicationStatus;
  requireMatchingDryRun?: boolean;
  receiptMetadata?: Prisma.InputJsonObject;
  /**
   * Destructive roster closure is only safe for a source bundle that declares
   * a complete edition-wide roster snapshot. Partial/manual imports must leave
   * unrelated open memberships untouched.
   */
  completeEditionRosterSnapshot?: boolean;
  /**
   * DataCoverage is one authoritative row per edition/match capability. A
   * different provider can replace that row only when the caller explicitly
   * selects incoming-source precedence.
   */
  coverageSourcePrecedence?: CoverageSourcePrecedence;
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
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date
      && right instanceof Date
      && left.getTime() === right.getTime();
  }
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

function ownedFieldsEqual(before: object, desired: object): boolean {
  const current = before as Record<string, unknown>;
  return Object.entries(desired).every(([field, value]) =>
    value === undefined || jsonValuesEqual(current[field], value));
}

function rowsById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function requiredRow<T>(rows: Map<string, T>, id: string, target: string): T {
  const row = rows.get(id);
  if (!row) throw new Error(`${target} bulk insert did not return row: ${id}`);
  return row;
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

function importPolicy(options: PrismaCompetitionImportWriterOptions): Prisma.InputJsonObject {
  return {
    completeEditionRosterSnapshot: options.completeEditionRosterSnapshot ?? false,
    coverageSourcePrecedence: options.coverageSourcePrecedence ?? 'REQUIRE_SAME_SOURCE',
  };
}

function previewStateFingerprint(preview: ImportPreview): string {
  return sourcePayloadChecksum(preview);
}

function importReceiptMatches(
  metadata: Prisma.JsonValue | null,
  options: PrismaCompetitionImportWriterOptions,
  preview: ImportPreview,
): boolean {
  if (!receiptMetadataMatches(metadata, options.receiptMetadata) || !isJsonObject(metadata)) {
    return false;
  }
  return jsonValuesEqual(metadata.importPolicy, importPolicy(options))
    && jsonValuesEqual(metadata.preview, jsonValue(preview))
    && metadata.previewStateFingerprint === previewStateFingerprint(preview);
}

function validateInputPreview(
  input: NormalizedCompetitionImport,
  preview: ImportPreview,
): void {
  const blockingIssue = validateNormalizedImport(input)
    .find((issue) => issue.severity === 'ERROR');
  if (blockingIssue) {
    throw new Error(`Import input failed validation: ${blockingIssue.code}: ${blockingIssue.message}`);
  }
  const inputChecksum = sourcePayloadChecksum(input);
  if (preview.checksum !== inputChecksum) {
    throw new Error('Import preview checksum does not match the normalized source input');
  }
}

/**
 * The receipt counters use one unit per physical canonical plan, not the
 * planner's provider-facing write hints. Match results are folded into the
 * MATCH row; their period rows remain distinct physical units. Source snapshot
 * and edition-source provenance are also first-class units.
 */
function physicalPlanUnitCount(
  input: NormalizedCompetitionImport,
  preview: ImportPreview,
): number {
  const mappingCount = input.teams.length + input.players.length + input.matches.length;
  const periodCount = input.results.reduce(
    (total, result) => total + (result.periods?.length ?? 0),
    0,
  );
  return input.teams.length
    + input.teams.length
    + input.players.length
    + input.rosters.length
    + input.matches.length
    + (input.matches.length * 2)
    + periodCount
    + preview.coverage.length
    + mappingCount
    + 1 // SOURCE_SNAPSHOT
    + 1; // EDITION_SOURCE
}

async function lockCompetitionForImport(
  transaction: Prisma.TransactionClient,
  competitionId: string,
): Promise<{ id: string; publicationStatus: PublicationStatus } | null> {
  const rows = await transaction.$queryRaw<Array<{
    id: string;
    publicationStatus: PublicationStatus;
  }>>(Prisma.sql`
    SELECT "id", "publicationStatus"
    FROM "Competition"
    WHERE "id" = ${competitionId}
    ORDER BY "id"
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

function importRunMetadata(
  options: PrismaCompetitionImportWriterOptions,
  preview: ImportPreview,
  extra: Record<string, unknown> = {},
): Prisma.InputJsonValue {
  return jsonValue({
    ...(options.receiptMetadata ?? {}),
    importPolicy: importPolicy(options),
    preview,
    previewStateFingerprint: previewStateFingerprint(preview),
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
  validateInputPreview(input, preview);

  return prisma.$transaction(async (transaction) => {
    const competition = await lockCompetitionForImport(transaction, options.competitionId);
    if (!competition) throw new Error(`Competition edition not found: ${options.competitionId}`);
    if (
      options.expectedPublicationStatus
      && competition.publicationStatus !== options.expectedPublicationStatus
    ) {
      throw new Error(
        `Import requires ${options.expectedPublicationStatus} edition status; found ${competition.publicationStatus}`,
      );
    }
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
    validateInputPreview(input, preview);

    const importRunId = randomUUID();
    const importStartedAt = new Date();
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const competition = await lockCompetitionForImport(
          transaction,
          this.options.competitionId,
        );
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
            importReceiptMatches(candidate.metadata, this.options, preview));
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
          importReceiptMatches(candidate.metadata, this.options, preview)) ?? null;

        const sourceMappings = await transaction.sourceEntityMapping.findMany({
          where: {
            sourceSystemId: source.id,
            competitionId: this.options.competitionId,
            entityType: { in: ['TEAM', 'PLAYER', 'MATCH'] },
          },
        });
        const mappingByIdentity = new Map<string, SourceEntityMapping>();
        for (const mapping of sourceMappings) {
          if (
            mapping.sourceSystemId !== source.id
            || mapping.competitionId !== this.options.competitionId
          ) {
            throw new Error(
              `Source mapping is outside the selected edition: ${mapping.entityType}/${mapping.externalId}`,
            );
          }
          const key = mappingKey(mapping.entityType, mapping.externalId);
          if (mappingByIdentity.has(key)) {
            throw new Error(`Duplicate source mapping identity: ${key}`);
          }
          mappingByIdentity.set(key, mapping);
        }
        const mappedTeamIds = sourceMappings
          .filter((mapping) => mapping.entityType === 'TEAM')
          .map((mapping) => mapping.internalEntityId);
        const mappedPlayerIds = sourceMappings
          .filter((mapping) => mapping.entityType === 'PLAYER')
          .map((mapping) => mapping.internalEntityId);
        const mappedMatchIds = sourceMappings
          .filter((mapping) => mapping.entityType === 'MATCH')
          .map((mapping) => mapping.internalEntityId);
        const canonicalChampionDataPlayerIds = input.players.flatMap((playerInput) =>
          playerInput.canonicalChampionDataPlayerId === undefined
            ? []
            : [playerInput.canonicalChampionDataPlayerId]);
        const [existingPlayers, existingTeams, existingMatches] = await Promise.all([
          transaction.player.findMany({
            where: {
              OR: [
                { id: { in: mappedPlayerIds } },
                { championDataPlayerId: { in: canonicalChampionDataPlayerIds } },
              ],
            },
          }),
          transaction.team.findMany({
            where: {
              OR: [
                { id: { in: mappedTeamIds } },
                { slug: { in: input.teams.map((teamInput) => teamInput.slug) } },
              ],
            },
          }),
          transaction.match.findMany({
            where: { id: { in: mappedMatchIds } },
          }),
        ]);
        const playerById = rowsById(existingPlayers);
        const teamById = rowsById(existingTeams);
        const matchById = rowsById(existingMatches);
        for (const mapping of sourceMappings) {
          if (mapping.entityType === 'TEAM') {
            const target = teamById.get(mapping.internalEntityId);
            if (!target) {
              throw new Error(
                `TEAM source mapping target does not exist: ${mapping.externalId}/${mapping.internalEntityId}`,
              );
            }
            if (target.competitionId !== this.options.competitionId) {
              throw new Error(
                `TEAM source mapping target belongs to another edition: ${mapping.externalId}/${mapping.internalEntityId}`,
              );
            }
          } else if (mapping.entityType === 'PLAYER') {
            if (!playerById.has(mapping.internalEntityId)) {
              throw new Error(
                `PLAYER source mapping target does not exist: ${mapping.externalId}/${mapping.internalEntityId}`,
              );
            }
          } else if (mapping.entityType === 'MATCH') {
            const target = matchById.get(mapping.internalEntityId);
            if (!target) {
              throw new Error(
                `MATCH source mapping target does not exist: ${mapping.externalId}/${mapping.internalEntityId}`,
              );
            }
            if (target.competitionId !== this.options.competitionId) {
              throw new Error(
                `MATCH source mapping target belongs to another edition: ${mapping.externalId}/${mapping.internalEntityId}`,
              );
            }
          }
        }
        const playerByChampionDataId = new Map(
          existingPlayers.flatMap((player) =>
            player.championDataPlayerId === null
              ? []
              : [[player.championDataPlayerId, player] as const]),
        );
        const reviewedCanonicalPlayers = new Map<string, Player>();
        for (const playerInput of input.players) {
          if (playerInput.canonicalChampionDataPlayerId === undefined) continue;

          const canonicalPlayer = playerByChampionDataId.get(
            playerInput.canonicalChampionDataPlayerId,
          );
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
          for (const [entityType, externalIds] of [
            ['TEAM', input.teams.map((item) => item.externalId)],
            ['PLAYER', input.players.map((item) => item.externalId)],
            ['MATCH', input.matches.map((item) => item.externalId)],
          ] as const) {
            for (const externalId of externalIds) {
              if (!mappingByIdentity.has(mappingKey(entityType, externalId))) {
                throw new Error(
                  `${entityType} source mapping is missing on replay: ${externalId}`,
                );
              }
            }
          }
        }

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

        if (priorRun) {
          const skipped = physicalPlanUnitCount(input, preview);
          await transaction.importRun.update({
            where: { id: importRunId },
            data: {
              status: 'SUCCEEDED',
              completedAt: completionTimestamp(importStartedAt),
              skippedCount: skipped,
            },
          });
          return {
            importRunId,
            checksum: preview.checksum,
            inserted: 0,
            updated: 0,
            skipped,
            publicationStatus: competition.publicationStatus,
          };
        }

        let mutationSequence = 0;
        let insertedMutationCount = 0;
        let updatedMutationCount = 0;
        let skippedMutationCount = 0;
        const mutationRows: Prisma.ImportMutationCreateManyInput[] = [];
        const recordMutation = (
          target: ImportMutationTarget,
          entityId: string,
          operation: ImportMutationOperation,
          before: object | null,
          after: object
        ) => {
          mutationSequence++;
          if (operation === 'INSERT') insertedMutationCount++;
          if (operation === 'UPDATE') updatedMutationCount++;
          mutationRows.push({
            importRunId,
            sequence: mutationSequence,
            operation,
            target,
            entityId,
            beforeData: before ? rowJson(before) : undefined,
            afterData: rowJson(after),
          });
        };
        const recordNoop = () => {
          skippedMutationCount++;
        };

        const [stages, groups] = await Promise.all([
          transaction.stage.findMany({
            where: { competitionId: this.options.competitionId },
          }),
          transaction.stageGroup.findMany({
            where: { stage: { competitionId: this.options.competitionId } },
            include: { stage: { select: { slug: true } } },
          }),
        ]);
        const stageBySlug = new Map(stages.map((stage) => [stage.slug, stage]));
        const groupBySlug = new Map(groups.map((group) => [group.slug, group]));
        const retrievedAt = new Date(input.context.retrievedAt);
        const teamBySlug = new Map(existingTeams.map((team) => [team.slug, team]));
        const teamIds = new Map<string, string>();
        const teamPlans: Array<{
          externalId: string;
          before: Team | null;
          id: string;
          desired: Pick<Team, 'name' | 'slug' | 'abbreviation'>;
        }> = [];
        for (const teamInput of input.teams) {
          const mapping = mappingByIdentity.get(mappingKey('TEAM', teamInput.externalId));
          const before = mapping
            ? teamById.get(mapping.internalEntityId) ?? null
            : teamBySlug.get(teamInput.slug)?.competitionId === this.options.competitionId
              ? teamBySlug.get(teamInput.slug) ?? null
              : null;

          if (!before) {
            const slugOwner = teamBySlug.get(teamInput.slug);
            if (slugOwner) {
              throw new Error(`Team slug is already used by another competition: ${teamInput.slug}`);
            }
          }
          const id = before?.id ?? randomUUID();
          const desired = {
            name: teamInput.name,
            slug: teamInput.slug,
            abbreviation: teamInput.abbreviation,
          };
          teamPlans.push({ externalId: teamInput.externalId, before, id, desired });
          teamIds.set(teamInput.externalId, id);
        }
        const persistedTeams = new Map<string, Team>();
        for (const plan of teamPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as Team;
          if (ownedFieldsEqual(before, plan.desired)) {
            persistedTeams.set(plan.id, before);
            recordNoop();
            continue;
          }
          const after = await transaction.team.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          persistedTeams.set(plan.id, after);
          recordMutation('TEAM', plan.id, 'UPDATE', before, after);
        }
        const teamCreates: Prisma.TeamCreateManyInput[] = teamPlans
          .filter((plan) => !plan.before)
          .map((plan) => ({
            id: plan.id,
            competitionId: this.options.competitionId,
            ...plan.desired,
          }));
        if (teamCreates.length > 0) {
          const created = rowsById(await transaction.team.createManyAndReturn({ data: teamCreates }));
          for (const plan of teamPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'TEAM');
            persistedTeams.set(plan.id, after);
            recordMutation('TEAM', plan.id, 'INSERT', null, after);
          }
        }

        const existingEntries = await transaction.editionEntry.findMany({
          where: {
            competitionId: this.options.competitionId,
            teamId: { in: [...teamIds.values()] },
          },
        });
        const entryByTeamId = new Map(existingEntries.map((entry) => [entry.teamId, entry]));
        const entryIds = new Map<string, string>();
        const entryPlans: Array<{
          before: EditionEntry | null;
          id: string;
          teamId: string;
          desired: Pick<EditionEntry, 'primaryGroupId' | 'seed' | 'status' | 'displayName'>;
        }> = [];
        for (const teamInput of input.teams) {
          const teamId = teamIds.get(teamInput.externalId);
          if (!teamId) throw new Error(`Team was not imported: ${teamInput.externalId}`);
          const group = teamInput.groupSlug ? groupBySlug.get(teamInput.groupSlug) : undefined;
          if (teamInput.groupSlug && !group) throw new Error(`Unknown team group: ${teamInput.groupSlug}`);
          const before = entryByTeamId.get(teamId) ?? null;
          const id = before?.id ?? randomUUID();
          entryPlans.push({
            before,
            id,
            teamId,
            desired: {
              primaryGroupId: group?.id ?? null,
              seed: teamInput.seed ?? null,
              status: teamInput.status ?? 'ACTIVE',
              displayName: teamInput.name,
            },
          });
          entryIds.set(teamInput.externalId, id);
        }
        const persistedEntries = new Map<string, EditionEntry>();
        for (const plan of entryPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as EditionEntry;
          if (ownedFieldsEqual(before, plan.desired)) {
            persistedEntries.set(plan.id, before);
            recordNoop();
            continue;
          }
          const after = await transaction.editionEntry.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          persistedEntries.set(plan.id, after);
          recordMutation('EDITION_ENTRY', plan.id, 'UPDATE', before, after);
        }
        const entryCreates: Prisma.EditionEntryCreateManyInput[] = entryPlans
          .filter((plan) => !plan.before)
          .map((plan) => ({
            id: plan.id,
            competitionId: this.options.competitionId,
            teamId: plan.teamId,
            enteredAt: retrievedAt,
            ...plan.desired,
          }));
        if (entryCreates.length > 0) {
          const created = rowsById(
            await transaction.editionEntry.createManyAndReturn({ data: entryCreates }),
          );
          for (const plan of entryPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'EDITION_ENTRY');
            persistedEntries.set(plan.id, after);
            recordMutation('EDITION_ENTRY', plan.id, 'INSERT', null, after);
          }
        }

        const playerIds = new Map<string, string>();
        const playerPlans: Array<{
          externalId: string;
          before: Player | null;
          id: string;
          teamId: string;
          desired: Prisma.PlayerUpdateInput;
          createData: Prisma.PlayerCreateManyInput;
        }> = [];
        for (const playerInput of input.players) {
          const teamId = teamIds.get(playerInput.teamExternalId);
          if (!teamId) throw new Error(`Player team was not imported: ${playerInput.teamExternalId}`);
          const mapping = mappingByIdentity.get(mappingKey('PLAYER', playerInput.externalId));
          const mappedPlayer = mapping
            ? playerById.get(mapping.internalEntityId) ?? null
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
          const id = before?.id ?? randomUUID();
          const isChampionDataPlayer = before?.championDataPlayerId != null;
          const canonicalIdentityWasReviewed =
            playerInput.canonicalChampionDataPlayerId !== undefined;
          const desired: Prisma.PlayerUpdateInput = isChampionDataPlayer
            ? canonicalIdentityWasReviewed
              ? photoFields
              : {}
            : {
              name: playerInput.name,
              position: playerInput.position,
              ...photoFields,
            };
          playerPlans.push({
            externalId: playerInput.externalId,
            before,
            id,
            teamId,
            desired,
            createData: {
              id,
              name: playerInput.name,
              position: playerInput.position,
              teamId,
              ...photoFields,
            },
          });
          playerIds.set(playerInput.externalId, id);
        }
        const persistedPlayers = new Map<string, Player>();
        for (const plan of playerPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as Player;
          if (ownedFieldsEqual(before, plan.desired)) {
            persistedPlayers.set(plan.id, before);
            recordNoop();
            continue;
          }
          const after = await transaction.player.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          persistedPlayers.set(plan.id, after);
          recordMutation('PLAYER', plan.id, 'UPDATE', before, after);
        }
        const playerCreates = playerPlans
          .filter((plan) => !plan.before)
          .map((plan) => plan.createData);
        if (playerCreates.length > 0) {
          const created = rowsById(
            await transaction.player.createManyAndReturn({ data: playerCreates }),
          );
          for (const plan of playerPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'PLAYER');
            persistedPlayers.set(plan.id, after);
            recordMutation('PLAYER', plan.id, 'INSERT', null, after);
          }
        }

        const existingOpenRosters = await transaction.rosterMembership.findMany({
          where: {
            editionEntry: { competitionId: this.options.competitionId },
            validTo: null,
          },
          orderBy: [{ validFrom: 'desc' }, { id: 'asc' }],
        });
        const rosterByIdentity = new Map<string, RosterMembership>();
        for (const roster of existingOpenRosters) {
          const key = `${roster.editionEntryId}:${roster.playerId}`;
          if (!rosterByIdentity.has(key)) rosterByIdentity.set(key, roster);
        }
        const incomingRosterKeys = new Set<string>();
        const playerInputByExternalId = new Map(
          input.players.map((playerInput) => [playerInput.externalId, playerInput]),
        );
        const rosterPlans: Array<{
          before: RosterMembership | null;
          id: string;
          editionEntryId: string;
          playerId: string;
          desired: Pick<RosterMembership, 'status' | 'designatedPosition' | 'bib' | 'isCaptain'>;
        }> = [];
        for (const rosterInput of input.rosters) {
          const editionEntryId = entryIds.get(rosterInput.teamExternalId);
          const playerId = playerIds.get(rosterInput.playerExternalId);
          if (!editionEntryId || !playerId) {
            throw new Error(`Roster identities were not imported: ${rosterInput.teamExternalId}/${rosterInput.playerExternalId}`);
          }
          const designatedPosition = playerInputByExternalId.get(
            rosterInput.playerExternalId,
          )?.position;
          const key = `${editionEntryId}:${playerId}`;
          const before = rosterByIdentity.get(key) ?? null;
          rosterPlans.push({
            before,
            id: before?.id ?? randomUUID(),
            editionEntryId,
            playerId,
            desired: {
              status: rosterInput.status ?? 'ACTIVE',
              designatedPosition: designatedPosition ?? null,
              bib: rosterInput.bib ?? null,
              isCaptain: rosterInput.isCaptain ?? false,
            },
          });
          incomingRosterKeys.add(key);
        }
        for (const plan of rosterPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as RosterMembership;
          if (ownedFieldsEqual(before, plan.desired)) {
            recordNoop();
            continue;
          }
          const after = await transaction.rosterMembership.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          recordMutation('ROSTER_MEMBERSHIP', plan.id, 'UPDATE', before, after);
        }
        const rosterCreates: Prisma.RosterMembershipCreateManyInput[] = rosterPlans
          .filter((plan) => !plan.before)
          .map((plan) => ({
            id: plan.id,
            editionEntryId: plan.editionEntryId,
            playerId: plan.playerId,
            validFrom: retrievedAt,
            ...plan.desired,
          }));
        if (rosterCreates.length > 0) {
          const created = rowsById(
            await transaction.rosterMembership.createManyAndReturn({ data: rosterCreates }),
          );
          for (const plan of rosterPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'ROSTER_MEMBERSHIP');
            recordMutation('ROSTER_MEMBERSHIP', plan.id, 'INSERT', null, after);
          }
        }

        if (this.options.completeEditionRosterSnapshot) {
          for (const staleRoster of existingOpenRosters
            .filter((roster) => roster.status === 'ACTIVE')
            .sort((left, right) => left.id.localeCompare(right.id))) {
            if (incomingRosterKeys.has(`${staleRoster.editionEntryId}:${staleRoster.playerId}`)) {
              continue;
            }
            const closedRoster = await transaction.rosterMembership.update({
              where: { id: staleRoster.id },
              data: {
                status: 'REPLACED',
                validTo: retrievedAt,
                notes: 'Closed by complete source-snapshot reconciliation',
              },
            });
            recordMutation(
              'ROSTER_MEMBERSHIP',
              closedRoster.id,
              'UPDATE',
              staleRoster,
              closedRoster,
            );
          }
        }

        const resultByMatchExternalId = new Map(
          input.results.map((resultInput) => [resultInput.matchExternalId, resultInput] as const),
        );
        const preserveResolvedParticipantMatchIds = new Set<string>();
        const matchIds = new Map<string, string>();
        const matchPlans: Array<{
          externalId: string;
          before: Match | null;
          id: string;
          desired: Prisma.MatchUncheckedUpdateInput;
          createData: Prisma.MatchCreateManyInput;
        }> = [];
        for (const matchInput of input.matches) {
          const stage = stageBySlug.get(matchInput.stageSlug);
          if (!stage) throw new Error(`Unknown match stage: ${matchInput.stageSlug}`);
          const group = matchInput.groupSlug ? groupBySlug.get(matchInput.groupSlug) : undefined;
          if (matchInput.groupSlug && (!group || group.stageId !== stage.id)) {
            throw new Error(`Match group does not belong to stage ${matchInput.stageSlug}: ${matchInput.groupSlug}`);
          }
          const mapping = mappingByIdentity.get(mappingKey('MATCH', matchInput.externalId));
          const before = mapping
            ? matchById.get(mapping.internalEntityId) ?? null
            : null;
          const homeTeamId = matchInput.sideA.teamExternalId
            ? teamIds.get(matchInput.sideA.teamExternalId)
            : undefined;
          const awayTeamId = matchInput.sideB.teamExternalId
            ? teamIds.get(matchInput.sideB.teamExternalId)
            : undefined;
          const resultInput = resultByMatchExternalId.get(matchInput.externalId);
          const preserveResultOwnedState = Boolean(
            before
            && !resultInput
            && (before.status === 'LIVE' || before.status === 'COMPLETED'),
          );
          const resultUpdateFields: Prisma.MatchUncheckedUpdateInput = resultInput
            ? {
              status: resultInput.status,
              homeScore: resultInput.sideAScore,
              awayScore: resultInput.sideBScore,
              resultQuality: resultInput.status === 'COMPLETED'
                ? 'PROVISIONAL'
                : before?.resultQuality ?? 'UNKNOWN',
              sourceUpdatedAt: retrievedAt,
            }
            : preserveResultOwnedState
              ? {}
              : matchInput.status === undefined
                ? {}
                : { status: matchInput.status };
          const resultCreateFields: Partial<Pick<
            Prisma.MatchCreateManyInput,
            'status' | 'homeScore' | 'awayScore' | 'resultQuality' | 'sourceUpdatedAt'
          >> = resultInput
            ? {
              status: resultInput.status,
              homeScore: resultInput.sideAScore,
              awayScore: resultInput.sideBScore,
              resultQuality: resultInput.status === 'COMPLETED' ? 'PROVISIONAL' : 'UNKNOWN',
              sourceUpdatedAt: retrievedAt,
            }
            : { status: matchInput.status ?? 'SCHEDULED' };
          const id = before?.id ?? randomUUID();
          const desired: Prisma.MatchUncheckedUpdateInput = {
            stageId: stage.id,
            stageGroupId: group?.id ?? null,
            ...(!preserveResultOwnedState && homeTeamId !== undefined ? { homeTeamId } : {}),
            ...(!preserveResultOwnedState && awayTeamId !== undefined ? { awayTeamId } : {}),
            round: matchInput.round ?? null,
            roundLabel: matchInput.roundLabel ?? null,
            venue: matchInput.venue,
            neutralVenue: matchInput.neutralVenue,
            scheduledAt: new Date(matchInput.scheduledAt),
            sourceRetrievedAt: retrievedAt,
            ...resultUpdateFields,
          };
          matchPlans.push({
            externalId: matchInput.externalId,
            before,
            id,
            desired,
            createData: {
              id,
              competitionId: this.options.competitionId,
              stageId: stage.id,
              stageGroupId: group?.id ?? null,
              homeTeamId: homeTeamId ?? null,
              awayTeamId: awayTeamId ?? null,
              round: matchInput.round ?? null,
              roundLabel: matchInput.roundLabel ?? null,
              venue: matchInput.venue,
              neutralVenue: matchInput.neutralVenue,
              scheduledAt: new Date(matchInput.scheduledAt),
              sourceRetrievedAt: retrievedAt,
              ...resultCreateFields,
            },
          });
          matchIds.set(matchInput.externalId, id);
          if (preserveResultOwnedState) preserveResolvedParticipantMatchIds.add(id);
        }
        const persistedMatches = new Map<string, Match>();
        for (const plan of matchPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as Match;
          if (ownedFieldsEqual(before, plan.desired)) {
            persistedMatches.set(plan.id, before);
            recordNoop();
            continue;
          }
          const after = await transaction.match.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          persistedMatches.set(plan.id, after);
          recordMutation('MATCH', plan.id, 'UPDATE', before, after);
        }
        const matchCreates = matchPlans
          .filter((plan) => !plan.before)
          .map((plan) => plan.createData);
        if (matchCreates.length > 0) {
          const created = rowsById(
            await transaction.match.createManyAndReturn({ data: matchCreates }),
          );
          for (const plan of matchPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'MATCH');
            persistedMatches.set(plan.id, after);
            recordMutation('MATCH', plan.id, 'INSERT', null, after);
          }
        }

        const existingSlots = await transaction.matchSlot.findMany({
          where: { matchId: { in: [...matchIds.values()] } },
        });
        const slotByIdentity = new Map(
          existingSlots.map((slot) => [`${slot.matchId}:${slot.side}`, slot]),
        );
        const slotPlans: Array<{
          before: MatchSlot | null;
          id: string;
          matchId: string;
          side: MatchSide;
          desired: Omit<Prisma.MatchSlotCreateManyInput, 'id' | 'matchId' | 'side'>;
        }> = [];
        const planSlot = (
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
          const before = slotByIdentity.get(`${matchId}:${sideName}`) ?? null;
          const preserveResolvedParticipant = preserveResolvedParticipantMatchIds.has(matchId);
          const persistedResolvedEntryId = preserveResolvedParticipant
            ? before?.resolvedEntryId ?? null
            : resolvedEntryId ?? before?.resolvedEntryId ?? null;
          const persistedResolvedAt = preserveResolvedParticipant
            ? before?.resolvedAt ?? null
            : resolvedEntryId
              ? before?.resolvedEntryId === resolvedEntryId && before.resolvedAt
                ? before.resolvedAt
                : retrievedAt
              : before?.resolvedEntryId
                ? before.resolvedAt
                : null;
          const desired = preserveResolvedParticipant && before
            ? {
              sourceType: before.sourceType,
              resolvedEntryId: before.resolvedEntryId,
              sourceGroupId: before.sourceGroupId,
              sourceRank: before.sourceRank,
              sourceMatchId: before.sourceMatchId,
              sourceLabel: before.sourceLabel,
              resolvedAt: before.resolvedAt,
            }
            : {
              sourceType,
              resolvedEntryId: persistedResolvedEntryId,
              sourceGroupId: sourceGroupId ?? null,
              sourceRank: sideInput.sourceRank ?? null,
              sourceMatchId: sourceMatchId ?? null,
              sourceLabel: sideInput.sourceLabel ?? null,
              resolvedAt: persistedResolvedAt,
            };
          slotPlans.push({
            before,
            id: before?.id ?? randomUUID(),
            matchId,
            side: sideName,
            desired,
          });
        };

        for (const matchInput of input.matches) {
          const matchId = matchIds.get(matchInput.externalId);
          if (!matchId) throw new Error(`Match was not imported: ${matchInput.externalId}`);
          planSlot(matchId, 'A', matchInput.sideA);
          planSlot(matchId, 'B', matchInput.sideB);
        }
        for (const plan of slotPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as MatchSlot;
          if (ownedFieldsEqual(before, plan.desired)) {
            recordNoop();
            continue;
          }
          const after = await transaction.matchSlot.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          recordMutation('MATCH_SLOT', plan.id, 'UPDATE', before, after);
        }
        const slotCreates: Prisma.MatchSlotCreateManyInput[] = slotPlans
          .filter((plan) => !plan.before)
          .map((plan) => ({
            id: plan.id,
            matchId: plan.matchId,
            side: plan.side,
            ...plan.desired,
          }));
        if (slotCreates.length > 0) {
          const created = rowsById(
            await transaction.matchSlot.createManyAndReturn({ data: slotCreates }),
          );
          for (const plan of slotPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'MATCH_SLOT');
            recordMutation('MATCH_SLOT', plan.id, 'INSERT', null, after);
          }
        }

        const resultMatchIds = input.results.flatMap((resultInput) => {
          const matchId = matchIds.get(resultInput.matchExternalId);
          return matchId ? [matchId] : [];
        });
        const existingQuarters = resultMatchIds.length > 0
          ? await transaction.matchQuarter.findMany({
            where: { matchId: { in: resultMatchIds } },
          })
          : [];
        const quarterByIdentity = new Map(
          existingQuarters.map((quarter) => [`${quarter.matchId}:${quarter.quarter}`, quarter]),
        );
        const quarterPlans: Array<{
          before: MatchQuarter | null;
          id: string;
          matchId: string;
          quarter: number;
          desired: Pick<MatchQuarter, 'homeScore' | 'awayScore'>;
        }> = [];
        for (const resultInput of input.results) {
          const matchId = matchIds.get(resultInput.matchExternalId);
          if (!matchId) throw new Error(`Result match was not imported: ${resultInput.matchExternalId}`);
          for (const period of resultInput.periods ?? []) {
            const before = quarterByIdentity.get(`${matchId}:${period.period}`) ?? null;
            quarterPlans.push({
              before,
              id: before?.id ?? randomUUID(),
              matchId,
              quarter: period.period,
              desired: { homeScore: period.sideAScore, awayScore: period.sideBScore },
            });
          }
        }
        for (const plan of quarterPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as MatchQuarter;
          if (ownedFieldsEqual(before, plan.desired)) {
            recordNoop();
            continue;
          }
          const after = await transaction.matchQuarter.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          recordMutation('MATCH_QUARTER', plan.id, 'UPDATE', before, after);
        }
        const quarterCreates: Prisma.MatchQuarterCreateManyInput[] = quarterPlans
          .filter((plan) => !plan.before)
          .map((plan) => ({
            id: plan.id,
            matchId: plan.matchId,
            quarter: plan.quarter,
            ...plan.desired,
          }));
        if (quarterCreates.length > 0) {
          const created = rowsById(
            await transaction.matchQuarter.createManyAndReturn({ data: quarterCreates }),
          );
          for (const plan of quarterPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'MATCH_QUARTER');
            recordMutation('MATCH_QUARTER', plan.id, 'INSERT', null, after);
          }
        }

        const existingCoverage = await transaction.dataCoverage.findMany({
          where: {
            competitionId: this.options.competitionId,
            OR: [
              { matchId: null },
              { matchId: { in: [...matchIds.values()] } },
            ],
          },
          orderBy: { id: 'asc' },
        });
        const coverageByIdentity = new Map<string, DataCoverage>();
        for (const coverage of existingCoverage) {
          const key = `${coverage.matchId ?? ''}:${coverage.capability}`;
          if (coverageByIdentity.has(key)) {
            throw new Error(`Duplicate persisted coverage identity: ${key}`);
          }
          coverageByIdentity.set(key, coverage);
        }
        const coveragePlans: Array<{
          before: DataCoverage | null;
          id: string;
          matchId: string | null;
          capability: DataCoverage['capability'];
          desired: Pick<DataCoverage, 'sourceSystemId' | 'state' | 'observedAt' | 'notes'>;
        }> = [];
        for (const coverageInput of preview.coverage) {
          const matchId = coverageInput.matchExternalId
            ? matchIds.get(coverageInput.matchExternalId)
            : undefined;
          if (coverageInput.matchExternalId && !matchId) {
            throw new Error(`Coverage match was not imported: ${coverageInput.matchExternalId}`);
          }
          const normalizedMatchId = matchId ?? null;
          const before = coverageByIdentity.get(
            `${normalizedMatchId ?? ''}:${coverageInput.capability}`,
          ) ?? null;
          if (
            before?.sourceSystemId
            && before.sourceSystemId !== source.id
            && (this.options.coverageSourcePrecedence ?? 'REQUIRE_SAME_SOURCE')
              !== 'INCOMING_SOURCE'
          ) {
            throw new Error(
              `Coverage source conflict requires explicit incoming-source precedence: ${coverageInput.matchExternalId ?? 'edition'}/${coverageInput.capability}/${before.sourceSystemId}/${source.id}`,
            );
          }
          coveragePlans.push({
            before,
            id: before?.id ?? randomUUID(),
            matchId: normalizedMatchId,
            capability: coverageInput.capability,
            desired: {
              sourceSystemId: source.id,
              state: coverageInput.state,
              observedAt: retrievedAt,
              notes: coverageInput.notes ?? null,
            },
          });
        }
        for (const plan of coveragePlans.filter((candidate) => candidate.before)) {
          const before = plan.before as DataCoverage;
          if (ownedFieldsEqual(before, plan.desired)) {
            recordNoop();
            continue;
          }
          const after = await transaction.dataCoverage.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          recordMutation('DATA_COVERAGE', plan.id, 'UPDATE', before, after);
        }
        const coverageCreates: Prisma.DataCoverageCreateManyInput[] = coveragePlans
          .filter((plan) => !plan.before)
          .map((plan) => ({
            id: plan.id,
            competitionId: this.options.competitionId,
            matchId: plan.matchId,
            capability: plan.capability,
            ...plan.desired,
          }));
        if (coverageCreates.length > 0) {
          const created = rowsById(
            await transaction.dataCoverage.createManyAndReturn({ data: coverageCreates }),
          );
          for (const plan of coveragePlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'DATA_COVERAGE');
            recordMutation('DATA_COVERAGE', plan.id, 'INSERT', null, after);
          }
        }

        const mappingMetadata = jsonValue({
          sourceKey: input.context.sourceKey,
          editionExternalId: input.context.editionExternalId,
          lastChecksum: preview.checksum,
        });
        const mappingTargets: Array<{
          entityType: 'TEAM' | 'PLAYER' | 'MATCH';
          externalId: string;
          internalEntityId: string;
        }> = [
          ...input.teams.map((teamInput) => ({
            entityType: 'TEAM' as const,
            externalId: teamInput.externalId,
            internalEntityId: teamIds.get(teamInput.externalId) as string,
          })),
          ...input.players.map((playerInput) => ({
            entityType: 'PLAYER' as const,
            externalId: playerInput.externalId,
            internalEntityId: playerIds.get(playerInput.externalId) as string,
          })),
          ...input.matches.map((matchInput) => ({
            entityType: 'MATCH' as const,
            externalId: matchInput.externalId,
            internalEntityId: matchIds.get(matchInput.externalId) as string,
          })),
        ];
        const mappingPlans: Array<{
          before: SourceEntityMapping | null;
          id: string;
          target: typeof mappingTargets[number];
          desired: Pick<SourceEntityMapping, 'internalEntityId' | 'verifiedAt'> & {
            metadata: Prisma.InputJsonValue;
          };
        }> = mappingTargets.map((target) => {
          const before = mappingByIdentity.get(mappingKey(target.entityType, target.externalId)) ?? null;
          return {
            before,
            id: before?.id ?? randomUUID(),
            target,
            desired: {
              internalEntityId: target.internalEntityId,
              metadata: mappingMetadata,
              verifiedAt: retrievedAt,
            },
          };
        });
        for (const plan of mappingPlans.filter((candidate) => candidate.before)) {
          const before = plan.before as SourceEntityMapping;
          if (ownedFieldsEqual(before, plan.desired)) {
            recordNoop();
            continue;
          }
          const after = await transaction.sourceEntityMapping.update({
            where: { id: plan.id },
            data: plan.desired,
          });
          mappingByIdentity.set(mappingKey(plan.target.entityType, plan.target.externalId), after);
          recordMutation('SOURCE_ENTITY_MAPPING', plan.id, 'UPDATE', before, after);
        }
        const mappingCreates: Prisma.SourceEntityMappingCreateManyInput[] = mappingPlans
          .filter((plan) => !plan.before)
          .map((plan) => ({
            id: plan.id,
            sourceSystemId: source.id,
            competitionId: this.options.competitionId,
            entityType: plan.target.entityType,
            externalId: plan.target.externalId,
            ...plan.desired,
          }));
        if (mappingCreates.length > 0) {
          const created = rowsById(
            await transaction.sourceEntityMapping.createManyAndReturn({ data: mappingCreates }),
          );
          for (const plan of mappingPlans.filter((candidate) => !candidate.before)) {
            const after = requiredRow(created, plan.id, 'SOURCE_ENTITY_MAPPING');
            mappingByIdentity.set(mappingKey(plan.target.entityType, plan.target.externalId), after);
            recordMutation('SOURCE_ENTITY_MAPPING', plan.id, 'INSERT', null, after);
          }
        }

        const snapshotDedupeKey = `${source.id}:${this.options.competitionId}:${preview.checksum}`;
        const snapshot = await transaction.sourceSnapshot.findUnique({
          where: { dedupeKey: snapshotDedupeKey },
        });
        if (!snapshot) {
          const createdSnapshot = await transaction.sourceSnapshot.create({
            data: {
              dedupeKey: snapshotDedupeKey,
              sourceSystemId: source.id,
              importRunId,
              competitionId: this.options.competitionId,
              entityType: 'COMPETITION_EDITION',
              externalId: input.context.editionExternalId,
              sourceUrl: input.context.sourceUrl,
              retrievedAt,
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
          recordMutation(
            'SOURCE_SNAPSHOT',
            createdSnapshot.id,
            'INSERT',
            null,
            createdSnapshot,
          );
        } else {
          recordNoop();
        }

        const editionSourceDesired = { lastSyncedAt: retrievedAt };
        if (ownedFieldsEqual(editionSource, editionSourceDesired)) {
          recordNoop();
        } else {
          const updatedEditionSource = await transaction.editionSource.update({
            where: { id: editionSource.id },
            data: editionSourceDesired,
          });
          recordMutation(
            'EDITION_SOURCE',
            editionSource.id,
            'UPDATE',
            editionSource,
            updatedEditionSource,
          );
        }

        if (mutationRows.length > 0) {
          await transaction.importMutation.createMany({ data: mutationRows });
        }

        const inserted = insertedMutationCount;
        const updated = updatedMutationCount;
        const skipped = skippedMutationCount;
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
