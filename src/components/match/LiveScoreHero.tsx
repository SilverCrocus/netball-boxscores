import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { TeamBadge } from '@/components/ui/TeamBadge';

interface TeamInfo {
  name: string;
  abbreviation: string;
  logoUrl?: string | null;
}

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
}: LiveScoreHeroProps) {
  const homeScore = liveScore?.homeScore ?? dbHomeScore;
  const awayScore = liveScore?.awayScore ?? dbAwayScore;
  const quarter = liveScore?.currentQuarter ?? dbQuarter;
  const time = liveScore?.currentTime ?? dbTime;
  const isLive = matchStatus?.status === 'LIVE' || dbIsLive;

  return (
    <div className="relative overflow-hidden rounded-xl bg-primary-container text-white p-8 md:p-12 shadow-2xl">
      {/* Gradient overlay */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-secondary/20 to-transparent pointer-events-none" />

      <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">
        {/* Home team */}
        <div className="flex flex-col items-center md:items-start text-center md:text-left gap-4">
          <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center p-2">
            <TeamBadge team={homeTeam} size={64} variant="home" />
          </div>
          <div>
            <h2 className="font-headline text-3xl font-extrabold tracking-tighter uppercase italic">
              {homeTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-xs tracking-widest uppercase">
              Home Team
            </p>
          </div>
        </div>

        {/* Score center */}
        <div className="flex flex-col items-center gap-2">
          {isLive && (
            <div className="bg-secondary px-3 py-1 rounded-full flex items-center gap-2 mb-4">
              <LiveIndicator />
              <span className="font-label text-[10px] font-bold uppercase tracking-tighter text-on-secondary">
                Q{quarter} {time && `\u2022 ${time}`}
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
          <p className="font-label text-xs uppercase tracking-widest text-secondary-fixed font-bold mt-4">
            Round {round} &bull; {venue}
          </p>
        </div>

        {/* Away team */}
        <div className="flex flex-col items-center md:items-end text-center md:text-right gap-4">
          <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center p-2">
            <TeamBadge team={awayTeam} size={64} variant="away" />
          </div>
          <div>
            <h2 className="font-headline text-3xl font-extrabold tracking-tighter uppercase italic">
              {awayTeam.name}
            </h2>
            <p className="text-on-primary-container font-label text-xs tracking-widest uppercase">
              Away Team
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
