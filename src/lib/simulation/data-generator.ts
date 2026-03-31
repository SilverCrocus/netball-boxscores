import type {
  CDFixtureResponse,
  CDFixtureMatch,
  CDMatchStatsResponse,
  CDMatchInfo,
  CDScoreFlowEntry,
  CDPlayerStats,
  CDTeamStats,
  CDPeriodScore,
} from '@/types/champion-data';
import type { SimMatch } from './types';
import { stateToMatchStatus, stateToPeriod } from './types';
import { pickStatFields, aggregateStats } from '@/lib/stat-utils';

export function buildFixtureResponse(matches: SimMatch[]): CDFixtureResponse {
  const now = new Date().toISOString();

  return {
    fixture: {
      jobId: 99999,
      match: matches.map((m): CDFixtureMatch => ({
        matchId: m.championDataMatchId,
        matchNumber: m.matchIndex + 1,
        matchType: 'Regular',
        roundNumber: 99,
        homeSquadId: m.homeSquadId,
        homeSquadName: m.homeSquadName,
        homeSquadCode: m.homeSquadCode,
        homeSquadShortCode: m.homeSquadCode,
        homeSquadNickname: m.homeSquadName.split(' ').pop() ?? m.homeSquadName,
        homeSquadScore: m.homeScore,
        awaySquadId: m.awaySquadId,
        awaySquadName: m.awaySquadName,
        awaySquadCode: m.awaySquadCode,
        awaySquadShortCode: m.awaySquadCode,
        awaySquadNickname: m.awaySquadName.split(' ').pop() ?? m.awaySquadName,
        awaySquadScore: m.awayScore,
        venue: m.venue,
        venueName: m.venue,
        venueId: 100 + m.matchIndex,
        venueCode: m.venue.substring(0, 3).toUpperCase(),
        localStartTime: now,
        utcStartTime: now,
        matchStatus: stateToMatchStatus(m.state),
        period: stateToPeriod(m.state),
        periodSecs: m.periodSeconds,
        periodCompleted: Math.max(0, stateToPeriod(m.state) - 1),
        isNetball2pt: true,
        finalCode: '',
        finalShortCode: '',
      })),
    },
  };
}

export function buildMatchStatsResponse(match: SimMatch): CDMatchStatsResponse {
  const homePlayerStats = match.playerStats.filter(
    (ps) => ps.squadId === match.homeSquadId,
  );
  const awayPlayerStats = match.playerStats.filter(
    (ps) => ps.squadId === match.awaySquadId,
  );

  const toCDPlayerStats = (ps: typeof match.playerStats[number]): CDPlayerStats => ({
    playerId: ps.playerId,
    displayName: ps.displayName,
    position: ps.position,
    squadId: ps.squadId,
    ...pickStatFields(ps),
  });

  const buildTeamStats = (
    players: typeof match.playerStats,
    squadId: number,
  ): CDTeamStats => ({
    squadId,
    ...aggregateStats(players),
  });

  // Build period scores from score flow
  const periodScores: CDPeriodScore[] = [];
  const currentPeriod = stateToPeriod(match.state);
  for (let p = 1; p <= currentPeriod; p++) {
    const periodFlow = match.scoreFlow.filter((sf) => sf.period === p);
    const lastEntry = periodFlow[periodFlow.length - 1];
    if (lastEntry) {
      periodScores.push({
        period: p,
        homeScore: lastEntry.homeScore,
        awayScore: lastEntry.awayScore,
      });
    } else {
      // Period with no scoring events yet
      const prevPeriod = periodScores[periodScores.length - 1];
      periodScores.push({
        period: p,
        homeScore: prevPeriod?.homeScore ?? 0,
        awayScore: prevPeriod?.awayScore ?? 0,
      });
    }
  }

  const matchInfo: CDMatchInfo = {
    matchId: match.championDataMatchId,
    round: 99,
    venue: match.venue,
    homeSquadId: match.homeSquadId,
    homeSquadName: match.homeSquadName,
    awaySquadId: match.awaySquadId,
    awaySquadName: match.awaySquadName,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    matchStatus: stateToMatchStatus(match.state),
    period: stateToPeriod(match.state),
    periodSeconds: match.periodSeconds,
  };

  const scoreFlow: CDScoreFlowEntry[] = match.scoreFlow.map((sf) => ({
    period: sf.period,
    periodSeconds: sf.periodSeconds,
    squadId: sf.squadId,
    scorepoints: sf.scorepoints,
    homeScore: sf.homeScore,
    awayScore: sf.awayScore,
  }));

  return {
    matchInfo,
    scoreFlow,
    teamStats: {
      home: buildTeamStats(homePlayerStats, match.homeSquadId),
      away: buildTeamStats(awayPlayerStats, match.awaySquadId),
    },
    playerStats: {
      home: homePlayerStats.map(toCDPlayerStats),
      away: awayPlayerStats.map(toCDPlayerStats),
    },
    periodScores,
  };
}
