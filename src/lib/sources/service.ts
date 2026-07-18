import type { PublicationStatus } from '@prisma/client';
import type { CompetitionSourceAdapter } from '@/lib/sources/adapter';
import { planCompetitionImport } from '@/lib/sources/planner';
import type { ImportPlanningContext, ImportPreview, NormalizedCompetitionImport } from '@/lib/sources/types';

export interface ImportExecutionReceipt {
  importRunId: string;
  checksum: string;
  inserted: number;
  updated: number;
  skipped: number;
  publicationStatus?: PublicationStatus;
}

export interface CompetitionImportWriter {
  execute(input: NormalizedCompetitionImport, preview: ImportPreview): Promise<ImportExecutionReceipt>;
  rollback(importRunId: string): Promise<void>;
}

export class CompetitionImportService<TInput> {
  constructor(
    private readonly adapter: CompetitionSourceAdapter<TInput>,
    private readonly planningContext: ImportPlanningContext,
    private readonly writer?: CompetitionImportWriter
  ) {}

  async preview(sourceInput: TInput): Promise<{ normalized: NormalizedCompetitionImport; preview: ImportPreview }> {
    const normalized = await this.adapter.normalize(sourceInput);
    return { normalized, preview: planCompetitionImport(normalized, this.planningContext) };
  }

  async execute(sourceInput: TInput): Promise<ImportExecutionReceipt> {
    const { normalized, preview } = await this.preview(sourceInput);
    if (!preview.valid) throw new Error('Import preview contains blocking validation errors');
    if (!this.writer) throw new Error('No import writer configured');
    return this.writer.execute(normalized, preview);
  }

  async rollback(importRunId: string): Promise<void> {
    if (!this.writer) throw new Error('No import writer configured');
    await this.writer.rollback(importRunId);
  }
}
