/**
 * Live win probability model for Super Netball.
 *
 * Uses the PFR/KenPom normal-distribution approach:
 * - Project final margin from current score differential + scoring rate differential
 * - Model remaining-game uncertainty as N(0, sigma * sqrt(time_remaining_fraction))
 * - P(win) = normalCDF(projected_margin / sigma)
 *
 * Pre-match prior derived from season results (avg goal differential per team).
 * Early in the game, the prior dominates; it fades as live data takes over.
 *
 * SSN-specific parameters derived from 2024-2025 season data:
 * - Average ~128 total goals per game (~64 per team, ~1.07/min/team)
 * - Standard deviation of final margins ≈ 13 goals
 */

import { prisma, excludeSimData } from '@/lib/db';

const QUARTER_SECONDS = 900;
const GAME_DURATION_SECONDS = 4 * QUARTER_SECONDS; // 3600s = 60 min
const BASE_SIGMA = 13;
const LEAGUE_AVG_RATE = 64 / 60; // goals per minute per team (~1.07)

// Don't produce probabilities until this many seconds have elapsed
const MIN_ELAPSED_FOR_PROJECTION = 120; // 2 minutes

// Floor on sigma to avoid extreme probabilities late in game
const MIN_SIGMA = 1.5;

// Standard normal CDF (Abramowitz & Stegun approximation)
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * absX);
  const y =
    1.0 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));

  return 0.5 * (1.0 + sign * y);
}

export interface PreMatchPrior {
  /** Expected margin advantage for home team (goals), from season data */
  expectedMargin: number;
  /** Home team avg goals per game */
  homeAvgGoals: number;
  /** Away team avg goals per game */
  awayAvgGoals: number;
}

export interface WinProbabilityInput {
  homeScore: number;
  awayScore: number;
  /** Current quarter (1-4, 5+ for ET) */
  quarter: number | null;
  /** Seconds elapsed in current period */
  periodSeconds: number;
  /** Full score flow for computing scoring rates */
  scoreFlow: Array<{
    period: number;
    periodSeconds: number;
    scoringTeamId: string;
    scorePoints?: number;
  }>;
  homeTeamId: string;
  /** Pre-match team strength prior (null if no season data) */
  prior: PreMatchPrior | null;
}

export interface WinProbabilityResult {
  homeWinPct: number; // 0-100
  awayWinPct: number; // 0-100
  drawPct: number; // negligible but included for completeness
  confidence: 'low' | 'medium' | 'high';
}

export function calculateWinProbability(
  input: WinProbabilityInput,
): WinProbabilityResult | null {
  const { homeScore, awayScore, quarter, periodSeconds, scoreFlow, homeTeamId, prior } =
    input;

  if (!quarter || quarter < 1) return null;

  // Total elapsed seconds
  const elapsed =
    (Math.min(quarter, 5) - 1) * QUARTER_SECONDS + periodSeconds;

  // Don't produce predictions in the first 2 minutes
  if (elapsed < MIN_ELAPSED_FOR_PROJECTION) return null;

  // Time remaining (cap at regulation for simplicity; ET handled below)
  const totalSeconds =
    quarter > 4
      ? GAME_DURATION_SECONDS + (quarter - 4) * 300
      : GAME_DURATION_SECONDS;
  const secondsRemaining = Math.max(0, totalSeconds - elapsed);

  // If game is over or effectively over
  if (secondsRemaining <= 0) {
    if (homeScore > awayScore) return { homeWinPct: 100, awayWinPct: 0, drawPct: 0, confidence: 'high' };
    if (awayScore > homeScore) return { homeWinPct: 0, awayWinPct: 100, drawPct: 0, confidence: 'high' };
    return { homeWinPct: 50, awayWinPct: 50, drawPct: 0, confidence: 'high' };
  }

  // Current score differential (positive = home leading)
  const currentDiff = homeScore - awayScore;

  // Base rates from prior (season averages) or league average
  const priorHomeRate = prior ? prior.homeAvgGoals / 60 : LEAGUE_AVG_RATE;
  const priorAwayRate = prior ? prior.awayAvgGoals / 60 : LEAGUE_AVG_RATE;

  // Compute per-team scoring rates from score flow
  const elapsedMinutes = elapsed / 60;
  let homeRate: number;
  let awayRate: number;

  if (elapsedMinutes > 3 && scoreFlow.length > 0) {
    let homePoints = 0;
    let awayPoints = 0;
    for (const entry of scoreFlow) {
      const pts = entry.scorePoints ?? 1;
      if (entry.scoringTeamId === homeTeamId) {
        homePoints += pts;
      } else {
        awayPoints += pts;
      }
    }
    const observedHomeRate = homePoints / elapsedMinutes;
    const observedAwayRate = awayPoints / elapsedMinutes;

    // Blend observed rates with prior — prior dominates early, observed dominates late
    // alpha ramps from 0.3 at 3min to 0.95 at 30min
    const alpha = Math.min(0.95, 0.3 + (elapsedMinutes - 3) * (0.65 / 27));
    homeRate = alpha * observedHomeRate + (1 - alpha) * priorHomeRate;
    awayRate = alpha * observedAwayRate + (1 - alpha) * priorAwayRate;
  } else {
    homeRate = priorHomeRate;
    awayRate = priorAwayRate;
  }

  // Project final margin, incorporating prior expected margin early in game
  const minutesRemaining = secondsRemaining / 60;
  let projectedMargin = currentDiff + (homeRate - awayRate) * minutesRemaining;

  // Blend in prior expected margin (fades as game progresses)
  if (prior) {
    const priorWeight = Math.max(0, 1 - elapsed / (GAME_DURATION_SECONDS * 0.5));
    projectedMargin += prior.expectedMargin * priorWeight;
  }

  // Uncertainty: shrinks with sqrt of time fraction remaining
  const timeFraction = secondsRemaining / GAME_DURATION_SECONDS;
  const sigma = Math.max(MIN_SIGMA, BASE_SIGMA * Math.sqrt(timeFraction));

  // P(home wins) = P(projected_margin > 0)
  const z = projectedMargin / sigma;
  const homeWinRaw = normalCDF(z) * 100;

  // Clamp to [1, 99] to avoid certainty claims
  const homeWinPct = Math.max(1, Math.min(99, homeWinRaw));
  const awayWinPct = 100 - homeWinPct;

  // Confidence based on time elapsed
  let confidence: 'low' | 'medium' | 'high';
  if (elapsed < 5 * 60) confidence = 'low';
  else if (elapsed < 30 * 60) confidence = 'medium';
  else confidence = 'high';

  return { homeWinPct, awayWinPct, drawPct: 0, confidence };
}

export async function computeTeamStrengthPrior(
  homeTeamId: string,
  awayTeamId: string,
  currentMatchId: string,
): Promise<PreMatchPrior | null> {
  const completedMatches = await prisma.match.findMany({
    where: {
      ...excludeSimData,
      status: 'COMPLETED',
      id: { not: currentMatchId },
      OR: [
        { homeTeamId: { in: [homeTeamId, awayTeamId] } },
        { awayTeamId: { in: [homeTeamId, awayTeamId] } },
      ],
    },
    select: {
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
    },
  });

  let homeGoalsFor = 0, homeGoalsAgainst = 0, homeGames = 0;
  let awayGoalsFor = 0, awayGoalsAgainst = 0, awayGames = 0;

  for (const m of completedMatches) {
    if (m.homeTeamId === homeTeamId) {
      homeGoalsFor += m.homeScore;
      homeGoalsAgainst += m.awayScore;
      homeGames++;
    } else if (m.awayTeamId === homeTeamId) {
      homeGoalsFor += m.awayScore;
      homeGoalsAgainst += m.homeScore;
      homeGames++;
    }
    if (m.homeTeamId === awayTeamId) {
      awayGoalsFor += m.homeScore;
      awayGoalsAgainst += m.awayScore;
      awayGames++;
    } else if (m.awayTeamId === awayTeamId) {
      awayGoalsFor += m.awayScore;
      awayGoalsAgainst += m.homeScore;
      awayGames++;
    }
  }

  if (homeGames < 3 || awayGames < 3) return null;

  const homeAvgGoals = homeGoalsFor / homeGames;
  const awayAvgGoals = awayGoalsFor / awayGames;
  const homeAvgConceded = homeGoalsAgainst / homeGames;
  const awayAvgConceded = awayGoalsAgainst / awayGames;

  // Expected margin: home's expected scoring - away's expected scoring
  // Each team's expected score = avg of (their attack vs opponent's defence)
  const homeExpected = (homeAvgGoals + awayAvgConceded) / 2;
  const awayExpected = (awayAvgGoals + homeAvgConceded) / 2;
  const expectedMargin = homeExpected - awayExpected;

  return { expectedMargin, homeAvgGoals: homeExpected, awayAvgGoals: awayExpected };
}
