interface EditionRosterIdentity {
  editionEntry: {
    competitionId: string;
    teamId: string;
  };
}

interface PlayerEditionIdentity {
  rosterMemberships: readonly EditionRosterIdentity[];
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
): string | null {
  const matchTeams = new Set(matchTeamIds);
  const memberships = player.rosterMemberships.filter(
    (membership) => membership.editionEntry.competitionId === competitionId
      && matchTeams.has(membership.editionEntry.teamId),
  );

  const teamIds = [...new Set(memberships.map((membership) => membership.editionEntry.teamId))];
  return teamIds.length === 1 ? teamIds[0] : null;
}
