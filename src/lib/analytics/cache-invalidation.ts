export interface AnalyticsInvalidation {
  matchId: string;
  competitionId: string;
  reason: string;
  revision: bigint;
  invalidatedAt: Date;
}

export interface AnalyticsInvalidationStore {
  listAfter(revision: bigint, limit: number): Promise<AnalyticsInvalidation[]>;
  acknowledge(matchIds: readonly string[]): Promise<void>;
}

export function assertInvalidationLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('Analytics invalidation batch size must be between 1 and 500');
  }
}
