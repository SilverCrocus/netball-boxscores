interface EditionRosterIdentity {
  status: 'ACTIVE' | 'REPLACED' | 'WITHDRAWN';
  validFrom: Date;
  validTo: Date | null;
  editionEntry: {
    competitionId: string;
    teamId: string;
  };
}

interface PlayerEditionIdentity {
  teamId?: string | null;
  rosterMemberships: readonly EditionRosterIdentity[];
}

interface MatchRosterMembership<Player extends { id: string }> {
  status: 'ACTIVE' | 'REPLACED' | 'WITHDRAWN';
  validFrom: Date;
  validTo: Date | null;
  player: Player;
}

function isEffectiveAt(
  membership: Pick<EditionRosterIdentity, 'validFrom' | 'validTo'>,
  referenceAt: Date,
): boolean {
  return membership.validFrom <= referenceAt
    && (membership.validTo === null || membership.validTo >= referenceAt);
}

/**
 * Resolve a player's side from the roster for this edition. A player's legacy
 * `teamId` represents their club and is not valid attribution for national
 * team matches.
 */
export function playerTeamIdForMatch(
  player: PlayerEditionIdentity,
  competitionId: string,
  matchTeamIds: readonly string[],
  scheduledAt: Date,
): string | null {
  const matchTeams = new Set(matchTeamIds);
  const editionMemberships = player.rosterMemberships.filter(
    (membership) => membership.editionEntry.competitionId === competitionId,
  );
  const matchMemberships = editionMemberships.filter(
    (membership) => matchTeams.has(membership.editionEntry.teamId),
  );

  const effectiveTeamIds = [...new Set(
    matchMemberships
      .filter((membership) => isEffectiveAt(membership, scheduledAt))
      .map((membership) => membership.editionEntry.teamId),
  )];
  if (effectiveTeamIds.length === 1) return effectiveTeamIds[0];
  if (effectiveTeamIds.length > 1) return null;

  // Once an edition roster record exists it is authoritative. A future,
  // expired, withdrawn, or different-side record must never be treated as a
  // historical backfill and must never fall through to the player's current
  // club identity.
  if (editionMemberships.length > 0) return null;

  // Legacy league rows with no edition roster data remain attributable only
  // when the permanent team is one of this match's two actual sides.
  return player.teamId && matchTeams.has(player.teamId) ? player.teamId : null;
}

/** Select the historical match roster or the current active live roster. */
export function rosterForMatch<
  Player extends { id: string },
  Membership extends MatchRosterMembership<Player>,
>(
  memberships: readonly Membership[],
  scheduledAt: Date,
  live: boolean,
  now = new Date(),
): Membership[] {
  const referenceAt = live ? now : scheduledAt;
  const byPlayer = new Map<string, Membership[]>();
  for (const membership of memberships) {
    const group = byPlayer.get(membership.player.id) ?? [];
    group.push(membership);
    byPlayer.set(membership.player.id, group);
  }

  const selected: Membership[] = [];
  for (const group of byPlayer.values()) {
    const effective = group
      .filter((membership) => (!live || membership.status === 'ACTIVE')
        && isEffectiveAt(membership, referenceAt))
      .toSorted((left, right) => right.validFrom.getTime() - left.validFrom.getTime());
    if (effective[0]) {
      selected.push(effective[0]);
      continue;
    }

  }

  return selected;
}
