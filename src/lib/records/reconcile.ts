import type { RecordCandidate, RecordReconciliation, StoredRecordEntry } from '@/lib/records/types';

function groupKey(entry: Pick<RecordCandidate, 'recordType' | 'metricId' | 'entityType' | 'scopeKey'>): string {
  return `${entry.recordType}|${entry.metricId}|${entry.entityType}|${entry.scopeKey}`;
}

function candidateKey(entry: Pick<RecordCandidate, 'entity' | 'supportingMatchId' | 'value'>): string {
  return `${entry.entity.id}|${entry.supportingMatchId ?? 'AGGREGATE'}|${entry.value}`;
}

export function reconcileRecordHistory(
  previous: readonly StoredRecordEntry[],
  candidates: readonly RecordCandidate[],
  correctedGroups: ReadonlySet<string> = new Set(),
): RecordReconciliation {
  const currentKeys = new Set(candidates.map(candidateKey));
  const activePrevious = previous.filter((entry) => entry.status === 'CONFIRMED' || entry.status === 'CORRECTED');
  const superseded = activePrevious
    .filter((entry) => !currentKeys.has(candidateKey(entry)))
    .map((entry) => ({ ...entry, status: 'SUPERSEDED' as const }));
  const previousByGroup = new Map<string, StoredRecordEntry>();
  for (const entry of activePrevious) if (!previousByGroup.has(groupKey(entry))) previousByGroup.set(groupKey(entry), entry);
  const existingKeys = new Set(activePrevious.map(candidateKey));
  const inserts = candidates
    .filter((candidate) => !existingKeys.has(candidateKey(candidate)))
    .map((candidate) => {
      const prior = previousByGroup.get(groupKey(candidate));
      const corrected = correctedGroups.has(groupKey(candidate));
      return {
        ...candidate,
        status: corrected ? 'CORRECTED' as const : candidate.status,
        supersedesId: prior?.id ?? null,
      };
    });
  return { superseded, inserts };
}

