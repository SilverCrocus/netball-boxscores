import { TeamBadge } from '@/components/ui/TeamBadge';
import { formatGameClock } from '@/lib/format';
import type { TeamInfo } from '@/types/team';
import type { QuarterData } from '@/types/match';

interface LiveScoreHeroProps {
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number;
  awayScore: number;
  round: number;
  venue: string;
  currentQuarter?: number | null;
  currentTime?: string | null;
  isLive: boolean;
  liveScore?: {
    homeScore: number;
    awayScore: number;
    currentQuarter: number;
    currentTime: string;
  } | null;
  matchStatus?: { status: 'LIVE' | 'COMPLETED' } | null;
  quarters?: QuarterData[];
}

function QuarterGrid({
  quarters,
  quarter,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
}: {
  quarters: QuarterData[];
  quarter: number | null | undefined;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  homeScore: number;
  awayScore: number;
}) {
  const hasET = (quarter ?? 0) > 4 || quarters.some((q) => q.quarter > 4);
  const periods = hasET ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
  const periodLabel = (p: number) => (p <= 4 ? `Q${p}` : 'ET');

  return (
    <table className="mt-2 border-separate" style={{ borderSpacing: '1px' }}>
      <thead>
        <tr>
          <th className="px-2.5 py-1 text-left text-[10px] font-bold uppercase tracking-[0.5px] text-white/40 font-label min-w-[34px]" />
          {periods.map((q) => (
            <th
              key={q}
              className={`px-3.5 py-1 text-center text-[10px] font-bold uppercase tracking-[0.5px] font-label min-w-[40px] ${
                q === quarter
                  ? 'bg-secondary/25 text-secondary-container'
                  : 'text-white/40'
              }`}
              style={{ background: q === quarter ? 'rgba(0,110,10,0.25)' : 'rgba(0,31,63,0.8)' }}
            >
              {periodLabel(q)}
            </th>
          ))}
          <th
            className="px-3.5 py-1 text-center text-[10px] font-extrabold uppercase tracking-[0.5px] text-white/60 font-label min-w-[40px]"
            style={{ background: 'rgba(0,31,63,0.8)' }}
          >
            T
          </th>
        </tr>
      </thead>
      <tbody>
        {[
          { abbr: homeTeam.abbreviation, side: 'home' as const },
          { abbr: awayTeam.abbreviation, side: 'away' as const },
        ].map(({ abbr, side }) => (
          <tr key={side}>
            <td
              className="px-2.5 py-1 text-left text-[10px] font-bold tracking-[0.5px] text-white/50 font-label"
              style={{ background: 'rgba(0,31,63,0.8)' }}
            >
              {abbr}
            </td>
            {periods.map((q) => {
              const qData = quarters.find((qd) => qd.quarter === q);
              const isActive = q === quarter;
              const value = qData
                ? side === 'home'
                  ? qData.homeScore
                  : qData.awayScore
                : null;

              return (
                <td
                  key={q}
                  className={`px-3.5 py-1 text-center text-xs font-label ${
                    isActive
                      ? 'font-bold text-secondary-container'
                      : value !== null
                        ? 'text-white/60'
                        : 'text-white/20'
                  }`}
                  style={{
                    background: isActive
                      ? 'rgba(0,110,10,0.25)'
                      : 'rgba(0,31,63,0.8)',
                  }}
                >
                  {value !== null ? value : '\u2013'}
                </td>
              );
            })}
            <td
              className="px-3.5 py-1 text-center text-xs font-extrabold text-white font-label"
              style={{ background: 'rgba(0,31,63,0.8)' }}
            >
              {side === 'home' ? homeScore : awayScore}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LiveScoreHero({
  homeTeam,
  awayTeam,
  homeScore: dbHomeScore,
  awayScore: dbAwayScore,
  round,
  venue,
  currentQuarter: dbQuarter,
  currentTime: dbTime,
  isLive: dbIsLive,
  liveScore,
  matchStatus,
  quarters,
}: LiveScoreHeroProps) {
  const homeScore = liveScore?.homeScore ?? dbHomeScore;
  const awayScore = liveScore?.awayScore ?? dbAwayScore;
  const quarter = liveScore?.currentQuarter ?? dbQuarter;
  const time = liveScore?.currentTime ?? dbTime;
  const isCompleted = matchStatus?.status === 'COMPLETED' || (!dbIsLive && dbHomeScore > 0 && !matchStatus);
  const isLive = !isCompleted && (matchStatus?.status === 'LIVE' || dbIsLive);

  return (
    <div className="relative overflow-hidden rounded-xl bg-primary-container text-white p-8 md:p-12 shadow-2xl">
      {/* Gradient overlay */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-secondary/20 to-transparent pointer-events-none" />

      <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10 max-w-[960px] mx-auto">
        {/* Home team */}
        <div className="flex items-center gap-4 flex-1 min-w-0 justify-end">
          <div className="w-[72px] h-[72px] rounded-full bg-white flex items-center justify-center p-2">
            <TeamBadge team={homeTeam} size={56} variant="home" />
          </div>
          <div>
            <h2 className="font-headline text-lg font-extrabold tracking-tighter uppercase italic">
              {homeTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-[10px] tracking-[2px] uppercase">
              Home Team
            </p>
          </div>
        </div>

        {/* Score center */}
        <div className="flex flex-col items-center gap-2">
          {isCompleted && (
            <div className="bg-surface-container-high text-on-surface-variant px-4 py-1.5 rounded-full mb-4">
              <span className="font-label text-xs font-bold uppercase tracking-[0.5px]">
                Full Time
              </span>
            </div>
          )}
          {isLive && (
            <div className="bg-secondary px-4 py-1.5 rounded-full flex items-center gap-2 mb-4">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              <span className="font-label text-xs font-bold uppercase tracking-[0.5px] text-white">
                {(quarter ?? 0) > 4 ? 'ET' : `Q${quarter}`} {time && `\u2022 ${formatGameClock(time, quarter)}`}
              </span>
            </div>
          )}
          <div className="flex items-center gap-8">
            <span className="font-headline text-7xl md:text-9xl font-black tracking-tighter">
              {homeScore}
            </span>
            <span className="font-headline text-2xl font-light text-on-primary-container">
              &mdash;
            </span>
            <span className="font-headline text-7xl md:text-9xl font-black tracking-tighter">
              {awayScore}
            </span>
          </div>
          {/* Quarter-by-quarter grid */}
          {quarters && quarters.length > 0 && (
            <QuarterGrid
              quarters={quarters}
              quarter={quarter}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homeScore={homeScore}
              awayScore={awayScore}
            />
          )}
          <p className="font-label text-xs uppercase tracking-widest text-secondary-fixed font-bold mt-4">
            Round {round} &bull; {venue}
          </p>
        </div>

        {/* Away team */}
        <div className="flex items-center gap-4 flex-1 min-w-0 flex-row-reverse justify-end">
          <div className="w-[72px] h-[72px] rounded-full bg-white flex items-center justify-center p-2">
            <TeamBadge team={awayTeam} size={56} variant="away" />
          </div>
          <div className="text-right">
            <h2 className="font-headline text-lg font-extrabold tracking-tighter uppercase italic">
              {awayTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-[10px] tracking-[2px] uppercase">
              Away Team
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
