export interface ComparisonPlayerOption {
  id: string;
  name: string;
  position: string;
  team: { name: string };
}

interface GroupedPlayerOptionsProps {
  players: ComparisonPlayerOption[];
}

export function groupPlayersByTeam(players: ComparisonPlayerOption[]) {
  const groups = new Map<string, ComparisonPlayerOption[]>();

  for (const player of players) {
    const teamName = player.team.name.trim() || 'Unassigned';
    const teamPlayers = groups.get(teamName) ?? [];
    teamPlayers.push(player);
    groups.set(teamName, teamPlayers);
  }

  return [...groups.entries()]
    .sort(([leftTeam], [rightTeam]) => leftTeam.localeCompare(rightTeam))
    .map(([teamName, teamPlayers]) => ({
      teamName,
      players: teamPlayers.toSorted((left, right) => left.name.localeCompare(right.name)),
    }));
}

export function GroupedPlayerOptions({ players }: GroupedPlayerOptionsProps) {
  return groupPlayersByTeam(players).map((group) => (
    <optgroup key={group.teamName} label={`${group.teamName} (${group.players.length})`}>
      {group.players.map((player) => (
        <option key={player.id} value={player.id}>
          {player.name} · {player.position}
        </option>
      ))}
    </optgroup>
  ));
}
