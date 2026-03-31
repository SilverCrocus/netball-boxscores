'use client';

import { useEffect, useRef, useMemo, useState } from 'react';
import { useMatchSocket } from '@/hooks/useMatchSocket';
import { LiveScoreHero } from '@/components/match/LiveScoreHero';
import { LiveLineups } from '@/components/match/LiveLineups';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import {
  LivePlayByPlay,
  type FeedEntry,
} from '@/components/match/LivePlayByPlay';
import type { StatsUpdatePayload } from '@/types/socket';
import { pickStatFields } from '@/lib/stat-utils';
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
}

interface LiveGameClientProps {
  match: MatchData;
}

// ─── Helpers ───

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
  const time = score?.currentTime ?? match.currentTime;
  const isLive = matchStatus?.status === 'COMPLETED' ? false : (matchStatus?.status === 'LIVE' || match.status === 'LIVE');

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

  // ── Scorer identification ──
  // Track previous goal counts to detect who scored
  const prevGoalsRef = useRef<Map<string, number>>(new Map());
  const [scorerLog, setScorerLog] = useState<
    Array<{ playerId: string; name: string; teamId: string }>
  >([]);

  // Initialize prev goals from SSR data
  useEffect(() => {
    const map = new Map<string, number>();
    for (const p of [
      ...match.homeTeam.players,
      ...match.awayTeam.players,
    ]) {
      map.set(p.id, p.goals);
    }
    prevGoalsRef.current = map;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect new goals on stats update
  useEffect(() => {
    if (!playerStats) return;
    const prev = prevGoalsRef.current;
    const allPlayers = [
      ...match.homeTeam.players,
      ...match.awayTeam.players,
    ];
    const newScorers: Array<{
      playerId: string;
      name: string;
      teamId: string;
    }> = [];

    for (const stat of playerStats.playerStats) {
      const prevGoalCount = prev.get(stat.playerId) ?? 0;
      if (stat.goals > prevGoalCount) {
        const player = allPlayers.find((p) => p.id === stat.playerId);
        const teamId = match.homeTeam.players.some(
          (p) => p.id === stat.playerId,
        )
          ? match.homeTeam.id
          : match.awayTeam.id;

        // One entry per goal scored (handles multi-goal updates)
        for (let i = 0; i < stat.goals - prevGoalCount; i++) {
          newScorers.push({
            playerId: stat.playerId,
            name: player?.name ?? 'Unknown',
            teamId,
          });
        }
      }
      prev.set(stat.playerId, stat.goals);
    }

    if (newScorers.length > 0) {
      setScorerLog((prev) => [...prev, ...newScorers]);
    }
  }, [playerStats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build enriched feed entries ──
  const feedEntries: FeedEntry[] = useMemo(() => {
    // Split scorer log by team for ordered matching
    const homeScorers = scorerLog.filter(
      (s) => s.teamId === match.homeTeam.id,
    );
    const awayScorers = scorerLog.filter(
      (s) => s.teamId === match.awayTeam.id,
    );

    let homeIdx = 0;
    let awayIdx = 0;

    return scoreFlow.map((flow) => {
      const isHome = flow.scoringTeamId === match.homeTeam.id;
      let scorerName: string | undefined;
      let scorerPlayerId: string | undefined;

      if (isHome && homeIdx < homeScorers.length) {
        scorerName = homeScorers[homeIdx].name;
        scorerPlayerId = homeScorers[homeIdx].playerId;
        homeIdx++;
      } else if (!isHome && awayIdx < awayScorers.length) {
        scorerName = awayScorers[awayIdx].name;
        scorerPlayerId = awayScorers[awayIdx].playerId;
        awayIdx++;
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
        isHomeTeam: isHome,
        homeScore: flow.homeScore,
        awayScore: flow.awayScore,
      };
    });
  }, [scoreFlow, scorerLog, match.homeTeam, match.awayTeam]);

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
