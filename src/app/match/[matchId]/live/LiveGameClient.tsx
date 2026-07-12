'use client';

import { useMemo } from 'react';
import { useMatchSocket } from '@/hooks/useMatchSocket';
import { mergeScoreFlows } from '@/lib/score-flow';
import { LiveScoreHero } from '@/components/match/LiveScoreHero';
import dynamic from 'next/dynamic';

const ScoreProgressChart = dynamic(
  () => import('@/components/match/ScoreProgressChart').then((m) => m.ScoreProgressChart),
  { ssr: false },
);
import { LiveLineups } from '@/components/match/LiveLineups';
import { MatchStatsComparison } from '@/components/match/MatchStatsComparison';
import { WinProbabilityBar } from '@/components/match/WinProbabilityBar';
import {
  LivePlayByPlay,
  type FeedEntry,
} from '@/components/match/LivePlayByPlay';
import type { StatsUpdatePayload, ScoreFlowAddPayload } from '@/types/socket';
import { pickStatFields, computeShootingPct } from '@/lib/stat-utils';
import { calculateWinProbability, type PreMatchPrior } from '@/lib/win-probability';
import type { PlayerStatRow } from '@/types/stats';
import type { QuarterData } from '@/types/match';
import type { TeamInfoWithId } from '@/types/team';

interface TeamData extends TeamInfoWithId {
  players: PlayerStatRow[];
}

interface MatchEventData {
  type: string;
  period: number;
  periodSeconds: number;
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  teamAbbreviation: string;
  teamLogoUrl: string | null;
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
  initialMatchEvents?: MatchEventData[];
  preMatchPrior?: PreMatchPrior | null;
}

interface LiveGameClientProps {
  match: MatchData;
}

// ─── Helpers ───

function parseTimeToSeconds(time: string): number {
  const parts = time.split(':');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

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
  scoreFlow: ScoreFlowAddPayload[],
  currentHomeScore: number,
  currentAwayScore: number,
  currentQuarter: number | null,
): QuarterData[] {
  if (!currentQuarter && scoreFlow.length === 0) return [];

  const maxPeriod = currentQuarter ?? Math.max(...scoreFlow.map((sf) => sf.period), 1);
  const quarters: QuarterData[] = [];

  for (let q = 1; q <= maxPeriod; q++) {
    const periodEntries = scoreFlow.filter((sf) => sf.period === q);
    if (periodEntries.length > 0) {
      const last = periodEntries[periodEntries.length - 1];
      const prevQuarterEntries = scoreFlow.filter((sf) => sf.period < q);
      const prevHome = prevQuarterEntries.length > 0
        ? prevQuarterEntries[prevQuarterEntries.length - 1].homeScore
        : 0;
      const prevAway = prevQuarterEntries.length > 0
        ? prevQuarterEntries[prevQuarterEntries.length - 1].awayScore
        : 0;
      quarters.push({
        quarter: q,
        homeScore: last.homeScore - prevHome,
        awayScore: last.awayScore - prevAway,
      });
    } else if (q === maxPeriod) {
      const prevHome = quarters.reduce((s, qr) => s + qr.homeScore, 0);
      const prevAway = quarters.reduce((s, qr) => s + qr.awayScore, 0);
      quarters.push({
        quarter: q,
        homeScore: currentHomeScore - prevHome,
        awayScore: currentAwayScore - prevAway,
      });
    } else {
      quarters.push({ quarter: q, homeScore: 0, awayScore: 0 });
    }
  }

  return quarters;
}

const sumStat = (players: PlayerStatRow[], key: keyof PlayerStatRow) =>
  players.reduce((sum, p) => sum + (Number(p[key]) || 0), 0);

// ─── Component ───

export function LiveGameClient({ match }: LiveGameClientProps) {
  const { score, playerStats, matchStatus, scoreFlow, statEvents } = useMatchSocket(
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

  // ── Merge initial + socket score flow, deduplicating ──
  const allScoreFlow = useMemo(() => {
    const initial = match.initialScoreFlow ?? [];
    return mergeScoreFlows(initial, scoreFlow);
  }, [match.initialScoreFlow, scoreFlow]);

  // ── Derive quarter scores from score flow (updates live as new goals arrive) ──
  const quarters = buildLiveQuarters(allScoreFlow, homeScore, awayScore, quarter);

  // ── Build enriched feed entries ──
  // Server-provided scorer info (from DB / socket) is used when available.
  // Falls back to a client-side heuristic (goal-diff since page load) for
  // any entries that don't yet have server attribution.
  const feedEntries: FeedEntry[] = useMemo(() => {
    // Client-side fallback: diff current goals vs SSR snapshot for entries
    // that arrived via socket without server-attributed scorers.
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

    const goalEntries = allScoreFlow.map((flow, idx) => {
      const isHome = flow.scoringTeamId === match.homeTeam.id;
      let scorerName: string | undefined = flow.scorerName;
      let scorerPlayerId: string | undefined = flow.scorerPlayerId;

      // Fallback: client-side heuristic for socket entries without server scorer
      if (!scorerPlayerId && idx >= initialCount) {
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
        eventType: 'goal' as const,
        scorerName,
        scorerPlayerId,
        teamAbbreviation: teamAbbr,
        teamName,
        teamLogoUrl: isHome ? match.homeTeam.logoUrl : match.awayTeam.logoUrl,
        isHomeTeam: isHome,
        homeScore: flow.homeScore,
        awayScore: flow.awayScore,
        scorePoints: flow.scorePoints,
      };
    });

    // Build stat event entries from persisted DB events + new socket events
    const allEvents = [
      ...(match.initialMatchEvents ?? []),
      ...statEvents.map((e) => ({
        type: e.type,
        period: e.quarter ?? 1,
        periodSeconds: parseInt(e.time, 10) || 0,
        playerId: e.playerId,
        playerName: e.playerName,
        teamId: e.teamId ?? '',
        teamName: e.teamName ?? '',
        teamAbbreviation: e.teamAbbreviation ?? '',
        teamLogoUrl: e.teamLogoUrl ?? null,
      })),
    ];

    // Deduplicate by unique key
    const seen = new Set<string>();
    const statEventEntries: FeedEntry[] = [];
    for (const e of allEvents) {
      const key = `${e.type}-${e.playerId}-${e.period}-${e.periodSeconds}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isHome = e.teamId === match.homeTeam.id;
      const mins = Math.floor(e.periodSeconds / 60);
      const secs = String(e.periodSeconds % 60).padStart(2, '0');

      statEventEntries.push({
        time: `${mins}:${secs}`,
        quarter: e.period,
        eventType: e.type as FeedEntry['eventType'],
        playerName: e.playerName,
        playerId: e.playerId,
        teamAbbreviation: e.teamAbbreviation,
        teamName: e.teamName,
        teamLogoUrl: e.teamLogoUrl,
        isHomeTeam: isHome,
      });
    }

    const combined = [...goalEntries, ...statEventEntries];
    combined.sort((a, b) => {
      if (a.quarter !== b.quarter) return a.quarter - b.quarter;
      const aSeconds = parseTimeToSeconds(a.time);
      const bSeconds = parseTimeToSeconds(b.time);
      return aSeconds - bSeconds;
    });
    return combined;
  }, [allScoreFlow, homePlayers, awayPlayers, match.homeTeam, match.awayTeam, match.initialScoreFlow, match.initialMatchEvents, statEvents]);

  // ── Score breakdown (goals vs super shots) ──
  const { homeBreakdown, awayBreakdown } = useMemo(() => {
    let homeGoals = 0, homeSuperShots = 0;
    let awayGoals = 0, awaySuperShots = 0;
    for (const flow of allScoreFlow) {
      const isHome = flow.scoringTeamId === match.homeTeam.id;
      if (flow.scorePoints === 2) {
        if (isHome) homeSuperShots++;
        else awaySuperShots++;
      } else {
        if (isHome) homeGoals++;
        else awayGoals++;
      }
    }
    return {
      homeBreakdown: { goals: homeGoals, superShots: homeSuperShots },
      awayBreakdown: { goals: awayGoals, superShots: awaySuperShots },
    };
  }, [allScoreFlow, match.homeTeam.id]);

  const superShotsByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    for (const flow of allScoreFlow) {
      if (flow.scorePoints === 2 && flow.scorerPlayerId) {
        map.set(flow.scorerPlayerId, (map.get(flow.scorerPlayerId) || 0) + 1);
      }
    }
    return map;
  }, [allScoreFlow]);

  // ── Comparison stats (6 stats) ──
  const homeGoals = sumStat(homePlayers, 'goals');
  const homeAttempts = sumStat(homePlayers, 'attempts');
  const awayGoals = sumStat(awayPlayers, 'goals');
  const awayAttempts = sumStat(awayPlayers, 'attempts');

  // ── Win probability ──
  const winProbability = useMemo(() => {
    const periodSeconds = time ? parseInt(time, 10) || 0 : 0;
    return calculateWinProbability({
      homeScore,
      awayScore,
      quarter,
      periodSeconds,
      scoreFlow: allScoreFlow,
      homeTeamId: match.homeTeam.id,
      prior: match.preMatchPrior ?? null,
    });
  }, [homeScore, awayScore, quarter, time, allScoreFlow, match.homeTeam.id, match.preMatchPrior]);

  const comparisonStats = [
    {
      label: 'Goals',
      homeValue: homeGoals,
      awayValue: awayGoals,
    },
    {
      label: 'Goal %',
      homeValue: Math.round(computeShootingPct(homeGoals, homeAttempts)),
      awayValue: Math.round(computeShootingPct(awayGoals, awayAttempts)),
      format: 'percentage' as const,
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
    {
      label: 'Centre Pass Receives',
      homeValue: sumStat(homePlayers, 'centrePassReceives'),
      awayValue: sumStat(awayPlayers, 'centrePassReceives'),
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
        homeBreakdown={homeBreakdown}
        awayBreakdown={awayBreakdown}
      />

      <ScoreProgressChart
        scoreFlow={allScoreFlow}
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        currentQuarter={quarter}
      />

      {isLive && winProbability && (
        <WinProbabilityBar
          probability={winProbability}
          homeTeam={match.homeTeam}
          awayTeam={match.awayTeam}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <LiveLineups
            homeTeam={{ ...match.homeTeam, players: homePlayers }}
            awayTeam={{ ...match.awayTeam, players: awayPlayers }}
            superShotsByPlayer={superShotsByPlayer}
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
