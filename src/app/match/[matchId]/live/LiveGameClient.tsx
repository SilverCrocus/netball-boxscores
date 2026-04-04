'use client';

import { useMemo } from 'react';
import { useMatchSocket } from '@/hooks/useMatchSocket';
import { LiveScoreHero } from '@/components/match/LiveScoreHero';
import { LiveLineups } from '@/components/match/LiveLineups';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import {
  LivePlayByPlay,
  type FeedEntry,
} from '@/components/match/LivePlayByPlay';
import type { StatsUpdatePayload, ScoreFlowAddPayload } from '@/types/socket';
import { pickStatFields } from '@/lib/stat-utils';
import { useLocalClock } from '@/hooks/useLocalClock';
import type { PlayerStatRow } from '@/types/stats';
import type { QuarterData } from '@/types/match';
import type { TeamInfoWithId } from '@/types/team';

interface TeamData extends TeamInfoWithId {
  players: PlayerStatRow[];
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
  quarters: QuarterData[];
  initialScoreFlow?: ScoreFlowAddPayload[];
}

interface LiveGameClientProps {
  match: MatchData;
}

// ─── Helpers ───

const VALID_POSITIONS = new Set(['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);

function mergePlayerStats(
  players: PlayerStatRow[],
  socketStats: StatsUpdatePayload | null,
): PlayerStatRow[] {
  if (!socketStats) return players;
  return players.map((player) => {
    const update = socketStats.playerStats.find(
      (s) => s.playerId === player.id,
    );
    if (!update) return player;
    return {
      ...player,
      ...pickStatFields(update),
      // Only apply live position if it's a valid standard netball position.
      // CD can send empty/non-standard codes for benched players — keeping
      // the DB position prevents players from vanishing from the lineup.
      ...(update.currentPosition && VALID_POSITIONS.has(update.currentPosition)
        ? { position: update.currentPosition }
        : {}),
    };
  });
}

function buildLiveQuarters(
  ssrQuarters: QuarterData[],
  currentHomeScore: number,
  currentAwayScore: number,
  currentQuarter: number | null,
): QuarterData[] {
  const completed = [...ssrQuarters];

  if (!currentQuarter) return completed;

  // If the current quarter is already in the completed data, return as-is
  if (completed.some((q) => q.quarter === currentQuarter)) return completed;

  // Derive current quarter score from total minus completed quarters
  const completedHome = completed.reduce((s, q) => s + q.homeScore, 0);
  const completedAway = completed.reduce((s, q) => s + q.awayScore, 0);

  return [
    ...completed,
    {
      quarter: currentQuarter,
      homeScore: currentHomeScore - completedHome,
      awayScore: currentAwayScore - completedAway,
    },
  ];
}

const sumStat = (players: PlayerStatRow[], key: keyof PlayerStatRow) =>
  players.reduce((sum, p) => sum + (Number(p[key]) || 0), 0);

// ─── Component ───

export function LiveGameClient({ match }: LiveGameClientProps) {
  const { score, playerStats, matchStatus, scoreFlow } = useMatchSocket(
    match.id,
  );

  // ── Live scores ──
  const homeScore = score?.homeScore ?? match.homeScore;
  const awayScore = score?.awayScore ?? match.awayScore;
  const quarter = score?.currentQuarter ?? match.currentQuarter;
  const serverTime = score?.currentTime ?? match.currentTime;
  const isLive = matchStatus?.status === 'COMPLETED' ? false : (matchStatus?.status === 'LIVE' || match.status === 'LIVE');

  // Tick the game clock locally between server updates
  const time = useLocalClock(isLive ? serverTime : null) ?? serverTime;

  // ── Merge socket stats into player data ──
  const homePlayers = mergePlayerStats(match.homeTeam.players, playerStats);
  const awayPlayers = mergePlayerStats(match.awayTeam.players, playerStats);

  // ── Derive quarter scores ──
  const quarters = buildLiveQuarters(
    match.quarters,
    homeScore,
    awayScore,
    quarter,
  );

  // ── Merge initial + socket score flow, deduplicating ──
  const allScoreFlow = useMemo(() => {
    const initial = match.initialScoreFlow ?? [];
    const seen = new Set(initial.map((sf) => `${sf.period}-${sf.periodSeconds}`));
    const newEntries = scoreFlow.filter(
      (sf) => !seen.has(`${sf.period}-${sf.periodSeconds}`),
    );
    return [...initial, ...newEntries];
  }, [match.initialScoreFlow, scoreFlow]);

  // ── Build enriched feed entries ──
  // Scorer detection is done synchronously here by comparing current
  // live-merged player goals with the SSR snapshot. This avoids the
  // timing issues of useEffect-based detection where the scorer log
  // updates asynchronously after render.
  const feedEntries: FeedEntry[] = useMemo(() => {
    // Build scorer lists by diffing current goals vs SSR initial goals.
    // Only players whose goals increased since page load are scorers.
    const homeScorers: Array<{ name: string; playerId: string }> = [];
    const awayScorers: Array<{ name: string; playerId: string }> = [];

    for (const player of homePlayers) {
      const initial = match.homeTeam.players.find((p) => p.id === player.id);
      const newGoals = player.goals - (initial?.goals ?? 0);
      for (let i = 0; i < newGoals; i++) {
        homeScorers.push({ name: player.name, playerId: player.id });
      }
    }
    for (const player of awayPlayers) {
      const initial = match.awayTeam.players.find((p) => p.id === player.id);
      const newGoals = player.goals - (initial?.goals ?? 0);
      for (let i = 0; i < newGoals; i++) {
        awayScorers.push({ name: player.name, playerId: player.id });
      }
    }

    const initialCount = (match.initialScoreFlow ?? []).length;
    let homeIdx = 0;
    let awayIdx = 0;

    return allScoreFlow.map((flow, idx) => {
      const isHome = flow.scoringTeamId === match.homeTeam.id;
      let scorerName: string | undefined;
      let scorerPlayerId: string | undefined;

      // Only match scorers to entries that arrived via socket (not historical)
      if (idx >= initialCount) {
        if (isHome && homeIdx < homeScorers.length) {
          scorerName = homeScorers[homeIdx].name;
          scorerPlayerId = homeScorers[homeIdx].playerId;
          homeIdx++;
        } else if (!isHome && awayIdx < awayScorers.length) {
          scorerName = awayScorers[awayIdx].name;
          scorerPlayerId = awayScorers[awayIdx].playerId;
          awayIdx++;
        }
      }

      const teamAbbr = isHome
        ? match.homeTeam.abbreviation
        : match.awayTeam.abbreviation;
      const teamName = isHome ? match.homeTeam.name : match.awayTeam.name;

      const mins = Math.floor(flow.periodSeconds / 60);
      const secs = String(flow.periodSeconds % 60).padStart(2, '0');

      return {
        time: `${mins}:${secs}`,
        quarter: flow.period,
        scorerName,
        scorerPlayerId,
        teamAbbreviation: teamAbbr,
        teamName,
        teamLogoUrl: isHome ? match.homeTeam.logoUrl : match.awayTeam.logoUrl,
        isHomeTeam: isHome,
        homeScore: flow.homeScore,
        awayScore: flow.awayScore,
      };
    });
  }, [allScoreFlow, homePlayers, awayPlayers, match.homeTeam, match.awayTeam, match.initialScoreFlow]);

  // ── Comparison stats (6 stats) ──
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
    {
      label: 'Feeds',
      homeValue: sumStat(homePlayers, 'feeds'),
      awayValue: sumStat(awayPlayers, 'feeds'),
    },
    {
      label: 'Goal Assists',
      homeValue: sumStat(homePlayers, 'goalAssists'),
      awayValue: sumStat(awayPlayers, 'goalAssists'),
    },
  ];

  // ── Render ──
  return (
    <section className="p-4 md:p-8 space-y-8 max-w-7xl mx-auto">
      <LiveScoreHero
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeScore={homeScore}
        awayScore={awayScore}
        round={match.round}
        venue={match.venue}
        currentQuarter={quarter}
        currentTime={time}
        isLive={isLive}
        liveScore={score}
        matchStatus={matchStatus}
        quarters={quarters}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <LiveLineups
            homeTeam={{ ...match.homeTeam, players: homePlayers }}
            awayTeam={{ ...match.awayTeam, players: awayPlayers }}
          />
          <MatchStatsComparison stats={comparisonStats} />
        </div>

        <div className="lg:col-span-1">
          <LivePlayByPlay entries={feedEntries} />
        </div>
      </div>
    </section>
  );
}
