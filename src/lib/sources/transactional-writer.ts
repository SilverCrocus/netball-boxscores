import { randomUUID } from 'node:crypto';
import type { CompetitionImportWriter, ImportExecutionReceipt } from '@/lib/sources/service';
import type { ImportPreview, NormalizedCompetitionImport, ProposedWrite } from '@/lib/sources/types';

export interface StoredCanonicalWrite {
  identityKey: string;
  target: string;
  externalId: string;
  checksum: string;
}

export interface StoredImportMutation {
  identityKey: string;
  before: StoredCanonicalWrite | null;
  after: StoredCanonicalWrite;
}

export interface StoredImportRun {
  id: string;
  checksum: string;
  status: 'SUCCEEDED' | 'ROLLED_BACK';
  preview: ImportPreview;
  rawPayload?: NormalizedCompetitionImport;
  mutations: StoredImportMutation[];
}

export interface ImportWriteTransaction {
  get(identityKey: string): Promise<StoredCanonicalWrite | null>;
  put(value: StoredCanonicalWrite): Promise<void>;
  delete(identityKey: string): Promise<void>;
  saveRun(run: StoredImportRun): Promise<void>;
  getRun(importRunId: string): Promise<StoredImportRun | null>;
}

export interface TransactionalImportStore {
  transaction<T>(callback: (transaction: ImportWriteTransaction) => Promise<T>): Promise<T>;
}

export interface TransactionalWriterOptions {
  rawPayloadStorageAllowed: boolean;
}

function storedWrite(write: ProposedWrite, checksum: string): StoredCanonicalWrite {
  return {
    identityKey: write.identityKey,
    target: write.target,
    externalId: write.externalId,
    checksum,
  };
}

/**
 * Repository-neutral reference writer. A store implementation supplies the
 * actual database transaction; the writer owns idempotency, audit, and rollback.
 */
export class TransactionalCompetitionImportWriter implements CompetitionImportWriter {
  constructor(
    private readonly store: TransactionalImportStore,
    private readonly options: TransactionalWriterOptions
  ) {}

  async execute(
    input: NormalizedCompetitionImport,
    preview: ImportPreview
  ): Promise<ImportExecutionReceipt> {
    if (!preview.valid) throw new Error('Cannot execute an invalid import preview');
    const importRunId = randomUUID();

    return this.store.transaction(async (transaction) => {
      const mutations: StoredImportMutation[] = [];
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const write of preview.writes) {
        const before = await transaction.get(write.identityKey);
        const after = storedWrite(write, preview.checksum);
        if (before?.checksum === preview.checksum) {
          skipped++;
          continue;
        }
        if (before) updated++;
        else inserted++;
        await transaction.put(after);
        mutations.push({ identityKey: write.identityKey, before, after });
      }

      await transaction.saveRun({
        id: importRunId,
        checksum: preview.checksum,
        status: 'SUCCEEDED',
        preview: structuredClone(preview),
        rawPayload: this.options.rawPayloadStorageAllowed
          ? structuredClone(input)
          : undefined,
        mutations,
      });

      return { importRunId, checksum: preview.checksum, inserted, updated, skipped };
    });
  }

  async rollback(importRunId: string): Promise<void> {
    await this.store.transaction(async (transaction) => {
      const run = await transaction.getRun(importRunId);
      if (!run) throw new Error(`Import run not found: ${importRunId}`);
      if (run.status === 'ROLLED_BACK') return;

      for (const mutation of run.mutations.toReversed()) {
        if (mutation.before) await transaction.put(mutation.before);
        else await transaction.delete(mutation.identityKey);
      }
      await transaction.saveRun({ ...run, status: 'ROLLED_BACK' });
    });
  }
}

export class InMemoryTransactionalImportStore implements TransactionalImportStore {
  private writes = new Map<string, StoredCanonicalWrite>();
  private runs = new Map<string, StoredImportRun>();

  async transaction<T>(callback: (transaction: ImportWriteTransaction) => Promise<T>): Promise<T> {
    const nextWrites = new Map(this.writes);
    const nextRuns = new Map(this.runs);
    const transaction: ImportWriteTransaction = {
      get: async (identityKey) => nextWrites.get(identityKey) ?? null,
      put: async (value) => { nextWrites.set(value.identityKey, structuredClone(value)); },
      delete: async (identityKey) => { nextWrites.delete(identityKey); },
      saveRun: async (run) => { nextRuns.set(run.id, structuredClone(run)); },
      getRun: async (id) => nextRuns.get(id) ?? null,
    };
    const result = await callback(transaction);
    this.writes = nextWrites;
    this.runs = nextRuns;
    return result;
  }

  get writeCount(): number {
    return this.writes.size;
  }

  getRun(id: string): StoredImportRun | null {
    return this.runs.get(id) ?? null;
  }
}
