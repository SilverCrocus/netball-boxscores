import { describe, expect, it, vi } from 'vitest';
import { ManualCompetitionAdapter } from '@/lib/sources/adapter';
import { CompetitionImportService } from '@/lib/sources/service';
import { validImport } from '@/lib/sources/__tests__/fixtures';

describe('CompetitionImportService', () => {
  it('does not start a writer when preview validation fails', async () => {
    const writer = { execute: vi.fn(), rollback: vi.fn() };
    const service = new CompetitionImportService(
      new ManualCompetitionAdapter(),
      {
        sourceSystemId: 'manual-source',
        competitionId: 'edition-id',
        existingIdentities: [],
        knownStageSlugs: [],
        standingsStrategyKey: 'WORLD_NETBALL_2_1_0',
      },
      writer
    );
    const input = validImport();

    await expect(service.execute(input)).rejects.toThrow('blocking validation errors');
    expect(writer.execute).not.toHaveBeenCalled();
  });

  it('delegates explicit rollback to the configured transactional writer', async () => {
    const writer = { execute: vi.fn(), rollback: vi.fn().mockResolvedValue(undefined) };
    const service = new CompetitionImportService(
      new ManualCompetitionAdapter(),
      {
        sourceSystemId: 'manual-source',
        competitionId: 'edition-id',
        existingIdentities: [],
        knownStageSlugs: ['pool-stage'],
        standingsStrategyKey: 'WORLD_NETBALL_2_1_0',
      },
      writer
    );

    await service.rollback('import-run-id');
    expect(writer.rollback).toHaveBeenCalledWith('import-run-id');
  });
});
