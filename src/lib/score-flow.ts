export interface ScoreFlowIdentity {
  period: number;
  periodSeconds: number;
  scoringTeamId: string;
}

export function getScoreFlowIdentity(entry: ScoreFlowIdentity): string {
  return `${entry.period}:${entry.periodSeconds}:${entry.scoringTeamId}`;
}

export function mergeScoreFlows<T extends ScoreFlowIdentity>(
  initial: readonly T[],
  incoming: readonly T[],
): T[] {
  const merged = new Map(initial.map((entry) => [getScoreFlowIdentity(entry), entry]));
  for (const entry of incoming) {
    // Socket payloads are newer than the SSR snapshot, so replace matching
    // identities to propagate corrected scores/scorePoints as well as additions.
    merged.set(getScoreFlowIdentity(entry), entry);
  }

  return Array.from(merged.values()).sort((left, right) => {
    if (left.period !== right.period) return left.period - right.period;
    if (left.periodSeconds !== right.periodSeconds) return left.periodSeconds - right.periodSeconds;

    const leftScore = left as T & { homeScore?: number; awayScore?: number };
    const rightScore = right as T & { homeScore?: number; awayScore?: number };
    const leftTotal = (leftScore.homeScore ?? 0) + (leftScore.awayScore ?? 0);
    const rightTotal = (rightScore.homeScore ?? 0) + (rightScore.awayScore ?? 0);
    if (leftTotal !== rightTotal) return leftTotal - rightTotal;
    if ((leftScore.homeScore ?? 0) !== (rightScore.homeScore ?? 0)) {
      return (leftScore.homeScore ?? 0) - (rightScore.homeScore ?? 0);
    }
    if ((leftScore.awayScore ?? 0) !== (rightScore.awayScore ?? 0)) {
      return (leftScore.awayScore ?? 0) - (rightScore.awayScore ?? 0);
    }
    return left.scoringTeamId.localeCompare(right.scoringTeamId);
  });
}
