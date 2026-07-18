export interface PlainBtreeIndexExpectation {
  name: string;
  tableName: string;
  columns: string[];
}

export interface IndexSemantics extends PlainBtreeIndexExpectation {
  unique: boolean;
  valid: boolean;
  ready: boolean;
  live: boolean;
  exclusion: boolean;
  clustered: boolean;
  nullsNotDistinct: boolean;
  method: string;
  predicate: string | null;
  hasExpressions: boolean;
  hasIncludedColumns: boolean;
  hasNondefaultSortOptions: boolean;
  hasNondefaultOperatorClasses: boolean;
  hasNondefaultCollations: boolean;
}

export function matchesPlainBtreeIndex(
  actual: IndexSemantics | undefined,
  expected: PlainBtreeIndexExpectation,
) {
  return Boolean(actual && actual.name === expected.name &&
    actual.tableName === expected.tableName &&
    JSON.stringify(actual.columns) === JSON.stringify(expected.columns) &&
    !actual.unique && actual.valid && actual.ready && actual.live &&
    !actual.exclusion && !actual.clustered && !actual.nullsNotDistinct &&
    actual.method === 'btree' && actual.predicate === null &&
    !actual.hasExpressions && !actual.hasIncludedColumns &&
    !actual.hasNondefaultSortOptions && !actual.hasNondefaultOperatorClasses &&
    !actual.hasNondefaultCollations);
}
