const FINALS_LABELS: Record<string, string> = {
  SEMI: 'Semi Finals',
  PRELIM: 'Preliminary Final',
  GRAND: 'Grand Final',
};

export function formatMatchStage(round: number, finalCode?: string | null): string {
  if (finalCode) {
    return FINALS_LABELS[finalCode.toUpperCase()] ?? finalCode;
  }

  return `Round ${round}`;
}
