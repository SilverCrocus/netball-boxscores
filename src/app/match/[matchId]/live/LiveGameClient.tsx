'use client';

import { useMatchSocket } from '@/hooks/useMatchSocket';
import { LiveScoreHero } from '@/components/match/LiveScoreHero';
import { LiveLineups } from '@/components/match/LiveLineups';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import { LivePlayByPlay } from '@/components/match/LivePlayByPlay';

interface PlayerData {
  id: string;
  name: string;
  position: string;
  goals: number;
  attempts: number;
  goalAssists: number;
  intercepts: number;
  deflections: number;
  rebounds: number;
  feeds: number;
  turnovers: number;
}

interface TeamData {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
  players: PlayerData[];
}

interface MatchData {
  id: string;
  round: number;
  venue: string;
  status: string;
  homeScore: number;
  awayScore: number;
  currentQuarter: number | null;
  currentTime: string | null;
  homeTeam: TeamData;
  awayTeam: TeamData;
}

interface LiveGameClientProps {
  match: MatchData;
}

export function LiveGameClient({ match }: LiveGameClientProps) {
  const { score, matchStatus, scoreFlow } = useMatchSocket(match.id);

  const homePlayers = match.homeTeam.players;
  const awayPlayers = match.awayTeam.players;

  const sumStat = (players: PlayerData[], key: keyof PlayerData) =>
    players.reduce((sum, p) => sum + (Number(p[key]) || 0), 0);

  const comparisonStats = [
    {
      label: 'Goals',
      homeValue: sumStat(homePlayers, 'goals'),
      awayValue: sumStat(awayPlayers, 'goals'),
    },
    {
      label: 'Intercepts',
      homeValue: sumStat(homePlayers, 'intercepts'),
      awayValue: sumStat(awayPlayers, 'intercepts'),
    },
    {
      label: 'Deflections',
      homeValue: sumStat(homePlayers, 'deflections'),
      awayValue: sumStat(awayPlayers, 'deflections'),
    },
    {
      label: 'Turnovers',
      homeValue: sumStat(homePlayers, 'turnovers'),
      awayValue: sumStat(awayPlayers, 'turnovers'),
    },
  ];

  // Build play-by-play entries from score flow
  const playByPlayEntries = scoreFlow.map((flow) => ({
    time: `${Math.floor(flow.periodSeconds / 60)}:${String(flow.periodSeconds % 60).padStart(2, '0')}`,
    quarter: flow.period,
    description: `Goal scored. ${flow.homeScore} - ${flow.awayScore}`,
    isScoring: true,
    score: `${flow.homeScore} - ${flow.awayScore}`,
  }));

  return (
    <section className="p-4 md:p-8 space-y-8 max-w-7xl mx-auto">
      <LiveScoreHero
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeScore={match.homeScore}
        awayScore={match.awayScore}
        round={match.round}
        venue={match.venue}
        currentQuarter={match.currentQuarter}
        currentTime={match.currentTime}
        isLive={match.status === 'LIVE'}
        liveScore={score}
        matchStatus={matchStatus}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <LiveLineups
            homeTeamName={match.homeTeam.name}
            awayTeamName={match.awayTeam.name}
            homePlayers={homePlayers}
            awayPlayers={awayPlayers}
          />
          <MatchStatsComparison stats={comparisonStats} />
        </div>

        <div className="lg:col-span-1">
          <LivePlayByPlay entries={playByPlayEntries} />
        </div>
      </div>
    </section>
  );
}
