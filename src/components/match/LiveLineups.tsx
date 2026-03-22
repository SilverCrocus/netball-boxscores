interface PlayerEntry {
  id: string;
  name: string;
  position: string;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  feeds: number;
}

interface LiveLineupsProps {
  homeTeamName: string;
  awayTeamName: string;
  homePlayers: PlayerEntry[];
  awayPlayers: PlayerEntry[];
}

function getStatLabel(player: PlayerEntry): string {
  if (player.position === 'GS' || player.position === 'GA') {
    return `${player.goals}/${player.attempts}`;
  }
  if (player.position === 'WA') return `${player.goalAssists} AST`;
  if (player.position === 'C') return `${player.feeds} FEED`;
  if (player.position === 'WD') return `${player.deflections} DEF`;
  if (player.position === 'GD') return `${player.intercepts} INT`;
  if (player.position === 'GK') return `${player.intercepts} INT`;
  return '';
}

export function LiveLineups({
  homeTeamName,
  awayTeamName,
  homePlayers,
  awayPlayers,
}: LiveLineupsProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/15">
      <h3 className="font-headline text-xl font-bold mb-6 flex items-center gap-2">
        <span className="material-symbols-outlined text-secondary">groups</span>
        Live Lineups
      </h3>
      <div className="grid grid-cols-2 gap-12">
        {/* Home team */}
        <div className="space-y-4">
          <p className="font-label text-[10px] font-black uppercase text-secondary border-b border-outline-variant pb-2">
            {homeTeamName}
          </p>
          <div className="space-y-3">
            {homePlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between group cursor-pointer p-2 rounded hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-primary-container text-white flex items-center justify-center text-[10px] font-bold">
                    {player.position}
                  </span>
                  <span className="font-body font-semibold">{player.name}</span>
                </div>
                <span className="font-label text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
                  {getStatLabel(player)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Away team */}
        <div className="space-y-4">
          <p className="font-label text-[10px] font-black uppercase text-secondary border-b border-outline-variant pb-2 text-right">
            {awayTeamName}
          </p>
          <div className="space-y-3">
            {awayPlayers.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between flex-row-reverse group cursor-pointer p-2 rounded hover:bg-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-3 flex-row-reverse">
                  <span className="w-8 h-8 rounded-full bg-secondary text-white flex items-center justify-center text-[10px] font-bold">
                    {player.position}
                  </span>
                  <span className="font-body font-semibold">{player.name}</span>
                </div>
                <span className="font-label text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-1 rounded">
                  {getStatLabel(player)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
