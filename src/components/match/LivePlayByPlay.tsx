interface PlayByPlayEntry {
  time: string;
  quarter: number;
  description: string;
  isScoring: boolean;
  score?: string;
}

interface LivePlayByPlayProps {
  entries: PlayByPlayEntry[];
}

export function LivePlayByPlay({ entries }: LivePlayByPlayProps) {
  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden shadow-2xl sticky top-24">
      <div className="bg-slate-900 p-4 border-b border-slate-800 flex items-center justify-between">
        <h4 className="text-white font-headline text-sm font-bold uppercase tracking-widest flex items-center gap-2">
          <span className="material-symbols-outlined text-lime-400 text-sm">
            sensors
          </span>
          Live Feed
        </h4>
        <span className="text-[10px] text-lime-400 font-bold uppercase">
          Real-Time
        </span>
      </div>
      <div className="h-[600px] overflow-y-auto p-4 space-y-6">
        {entries.length === 0 && (
          <p className="text-slate-500 text-sm text-center mt-8">
            Waiting for live events...
          </p>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-4 relative">
            <div className="flex-none flex flex-col items-center">
              <div
                className={`w-1.5 h-1.5 rounded-full mt-2 ${
                  entry.isScoring ? 'bg-lime-400' : 'bg-slate-600'
                }`}
              />
              {i < entries.length - 1 && (
                <div className="w-px h-full bg-slate-800 mt-2" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-slate-500 font-headline uppercase">
                {entry.time} - Q{entry.quarter}
              </p>
              <p
                className={`text-sm ${
                  entry.isScoring
                    ? 'text-white font-medium'
                    : 'text-slate-300'
                }`}
              >
                {entry.description}
              </p>
              {entry.score && (
                <p className="text-lime-400 text-[10px] font-bold uppercase">
                  Score: {entry.score}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
