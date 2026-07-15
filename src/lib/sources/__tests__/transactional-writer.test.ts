import { describe, expect, it } from 'vitest';
import { ManualCompetitionAdapter } from '@/lib/sources/adapter';
import { CompetitionImportService } from '@/lib/sources/service';
import {
  InMemoryTransactionalImportStore,
  TransactionalCompetitionImportWriter,
} from '@/lib/sources/transactional-writer';
import { validImport } from '@/lib/sources/__tests__/fixtures';

function service(rawPayloadStorageAllowed = false) {
  const store = new InMemoryTransactionalImportStore();
  const writer = new TransactionalCompetitionImportWriter(store, { rawPayloadStorageAllowed });
  return {
    store,
    service: new CompetitionImportService(
      new ManualCompetitionAdapter(),
      {
        sourceSystemId: 'manual-source',
        competitionId: 'edition-id',
        existingIdentities: [],
        knownStageSlugs: ['pool-stage'],
        standingsStrategyKey: 'WORLD_NETBALL_2_1_0',
      },
      writer
    ),
  };
}

describe('TransactionalCompetitionImportWriter', () => {
  it('is idempotent when the same source payload is replayed', async () => {
    const setup = service();
    const first = await setup.service.execute(validImport());
    const countAfterFirst = setup.store.writeCount;
    const second = await setup.service.execute(validImport());

    expect(first.inserted).toBeGreaterThan(0);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBe(countAfterFirst);
    expect(setup.store.writeCount).toBe(countAfterFirst);
  });

  it('rolls back only mutations made by the selected import run', async () => {
    const setup = service();
    const receipt = await setup.service.execute(validImport());
    expect(setup.store.writeCount).toBeGreaterThan(0);

    await setup.service.rollback(receipt.importRunId);

    expect(setup.store.writeCount).toBe(0);
    expect(setup.store.getRun(receipt.importRunId)?.status).toBe('ROLLED_BACK');
  });

  it('stores raw payloads only when the source licence permits it', async () => {
    const denied = service(false);
    const deniedReceipt = await denied.service.execute(validImport());
    expect(denied.store.getRun(deniedReceipt.importRunId)?.rawPayload).toBeUndefined();

    const allowed = service(true);
    const allowedReceipt = await allowed.service.execute(validImport());
    expect(allowed.store.getRun(allowedReceipt.importRunId)?.rawPayload).toEqual(validImport());
  });
});
