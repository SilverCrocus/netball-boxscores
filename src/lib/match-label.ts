const FINALS_LABELS: Record<string, string> = {
  SEMI: 'Semi Finals',
  PRELIM: 'Preliminary Final',
  GRAND: 'Grand Final',
};

export function formatMatchStage(
  round?: number | null,
  finalCode?: string | null,
  roundLabel?: string | null,
  stageName?: string | null,
): string {
  const explicitLabel = roundLabel?.trim();
  if (explicitLabel) return explicitLabel;

  if (finalCode) {
    return FINALS_LABELS[finalCode.toUpperCase()] ?? finalCode;
  }

  if (round !== null && round !== undefined) return `Round ${round}`;

  return stageName?.trim() || 'Match';
}
