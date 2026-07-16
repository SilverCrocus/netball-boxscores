export interface PlayerPhotoPolicyInput {
  photoUrl?: string | null;
  photoSourceUrl?: string | null;
  photoCredit?: string | null;
  photoLicense?: string | null;
}

/**
 * Licensed/reused photos are shown only where their source, credit and licence
 * are visible (the player profile). Compact surfaces use the initials fallback
 * instead of separating an image from its required attribution.
 */
export function secondaryPlayerPhotoUrl(
  player: PlayerPhotoPolicyInput,
): string | null {
  const hasReuseProvenance = Boolean(
    player.photoSourceUrl || player.photoCredit || player.photoLicense,
  );

  return hasReuseProvenance ? null : player.photoUrl ?? null;
}
