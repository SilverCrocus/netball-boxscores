import type { NormalizedCompetitionImport } from '@/lib/sources/types';

export interface CompetitionSourceAdapter<TInput = unknown> {
  readonly format: string;
  normalize(input: TInput): Promise<NormalizedCompetitionImport>;
}

export class ManualCompetitionAdapter
implements CompetitionSourceAdapter<NormalizedCompetitionImport> {
  readonly format = 'manual';

  async normalize(input: NormalizedCompetitionImport): Promise<NormalizedCompetitionImport> {
    return structuredClone(input);
  }
}

export class JsonCompetitionAdapter implements CompetitionSourceAdapter<string | unknown> {
  readonly format = 'json';

  async normalize(input: string | unknown): Promise<NormalizedCompetitionImport> {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON import must contain one competition import object');
    }
    return structuredClone(parsed as NormalizedCompetitionImport);
  }
}
