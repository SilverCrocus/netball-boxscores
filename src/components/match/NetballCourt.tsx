import type { Position } from '@prisma/client';

interface CourtPlayer {
  id: string;
  name: string;
  position: Position;
  teamId: string;
}

interface NetballCourtProps {
  homePlayers: CourtPlayer[];
  awayPlayers: CourtPlayer[];
}

// Static positions on court (percentage-based x,y).
// Court is vertical: home attacks top, away attacks bottom.
const POSITION_COORDS: Record<Position, { x: number; y: number }> = {
  GS: { x: 42, y: 8 },
  GA: { x: 30, y: 20 },
  WA: { x: 25, y: 40 },
  C: { x: 55, y: 50 },
  WD: { x: 75, y: 60 },
  GD: { x: 60, y: 78 },
  GK: { x: 55, y: 92 },
};

// Away team mirrors: flip y axis
const AWAY_POSITION_COORDS: Record<Position, { x: number; y: number }> = {
  GS: { x: 58, y: 92 },
  GA: { x: 70, y: 80 },
  WA: { x: 75, y: 60 },
  C: { x: 45, y: 50 },
  WD: { x: 25, y: 40 },
  GD: { x: 40, y: 22 },
  GK: { x: 45, y: 8 },
};

export function NetballCourt({ homePlayers, awayPlayers }: NetballCourtProps) {
  return (
    <div className="bg-slate-950 rounded-3xl overflow-hidden shadow-2xl relative aspect-[3/4] md:aspect-[16/10] border-4 border-slate-900">
      <div className="absolute inset-0 flex flex-col p-8 md:p-12 overflow-hidden">
        <div className="w-full h-full border-2 border-slate-700/50 rounded-xl relative flex flex-col">
          {/* Thirds lines */}
          <div
            data-testid="thirds-line-1"
            className="absolute top-1/3 left-0 w-full h-0 border-t border-slate-700/50"
          />
          <div
            data-testid="thirds-line-2"
            className="absolute top-2/3 left-0 w-full h-0 border-t border-slate-700/50"
          />

          {/* Centre circle */}
          <div
            data-testid="centre-circle"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 border border-slate-700/50 rounded-full flex items-center justify-center"
          >
            <div className="w-2 h-2 bg-lime-400 rounded-full blur-[1px]" />
          </div>

          {/* Shooting circles */}
          <div
            data-testid="shooting-circle-top"
            className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 border-b border-x border-slate-700/50 rounded-b-full"
          />
          <div
            data-testid="shooting-circle-bottom"
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-48 h-24 border-t border-x border-slate-700/50 rounded-t-full"
          />

          {/* Goal rings */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-3 h-3 bg-secondary rounded-full" />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-3 h-3 bg-secondary rounded-full" />

          {/* Home team players (primary-container blue) */}
          {homePlayers.map((player) => {
            const coords = POSITION_COORDS[player.position];
            return (
              <div
                key={player.id}
                data-testid={`player-node-${player.id}`}
                className="absolute flex flex-col items-center"
                style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
              >
                <div className="w-8 h-8 md:w-10 md:h-10 bg-primary-container text-white border-2 border-on-primary-container rounded-full flex items-center justify-center font-black font-headline text-xs shadow-lg shadow-primary-container/40">
                  {player.position}
                </div>
              </div>
            );
          })}

          {/* Away team players (lime green) */}
          {awayPlayers.map((player) => {
            const coords = AWAY_POSITION_COORDS[player.position];
            return (
              <div
                key={player.id}
                data-testid={`player-node-${player.id}`}
                className="absolute flex flex-col items-center"
                style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
              >
                <div className="w-8 h-8 md:w-10 md:h-10 bg-lime-500 text-slate-950 border-2 border-lime-300 rounded-full flex items-center justify-center font-black font-headline text-xs shadow-lg shadow-lime-500/40">
                  {player.position}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
