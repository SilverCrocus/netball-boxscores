import { Router, json } from 'express';
import type { SimState, SimMatchState } from './types';
import {
  createSimState,
  setupSimMatches,
  teardownSimMatches,
  tickAllMatches,
  tickMatch,
} from './engine';
import { buildFixtureResponse, buildMatchStatsResponse } from './data-generator';
import { STATE_ORDER } from './types';

const router = Router();
router.use(json());

let simState: SimState = createSimState({ matchCount: 2, speed: 1, tickStep: 30 });
let tickTimer: ReturnType<typeof setInterval> | null = null;

function getTickIntervalMs(): number {
  const baseInterval = 30_000; // 30s at 1x
  return baseInterval / simState.config.speed;
}

function startAutoTick(): void {
  stopAutoTick();
  tickTimer = setInterval(() => {
    if (!simState.paused && simState.running) {
      simState = tickAllMatches(simState);
    }
  }, getTickIntervalMs());
}

function stopAutoTick(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

// ───── Debug logging ─────

router.use((req, _res, next) => {
  console.log(`[Sim] ${req.method} ${req.originalUrl}`);
  next();
});

// ───── Data endpoints (polled by worker) ─────

router.get('/fixture.json', (_req, res) => {
  console.log(`[Sim] Serving fixture — ${simState.matches.length} matches`);
  const response = buildFixtureResponse(simState.matches);
  res.json(response);
});

router.get('/:matchId.json', (req, res) => {
  const matchId = parseInt(req.params.matchId, 10);
  const match = simState.matches.find((m) => m.championDataMatchId === matchId);

  if (!match) {
    res.status(404).json({ error: 'Simulated match not found' });
    return;
  }

  const response = buildMatchStatsResponse(match);
  res.json(response);
});

// ───── Control endpoint ─────

router.post('/control', async (req, res) => {
  const { action, ...params } = req.body;

  switch (action) {
    case 'start': {
      if (simState.running) {
        res.status(400).json({ error: 'Simulation already running' });
        return;
      }
      const matchCount = params.matchCount ?? 2;
      simState = createSimState({
        matchCount,
        speed: params.speed ?? 1,
        tickStep: params.tickStep ?? 30,
      });
      simState.matches = await setupSimMatches(matchCount);
      simState.running = true;
      simState.log.push({
        timestamp: Date.now(),
        matchIndex: -1,
        message: `Simulation started with ${matchCount} match(es)`,
      });
      startAutoTick();
      res.json({ ok: true, matches: simState.matches.length });
      return;
    }

    case 'stop': {
      stopAutoTick();
      if (simState.matches.length > 0) {
        await teardownSimMatches(simState.matches);
      }
      simState = createSimState({ matchCount: 2, speed: 1, tickStep: 30 });
      res.json({ ok: true });
      return;
    }

    case 'pause': {
      simState.paused = true;
      res.json({ ok: true });
      return;
    }

    case 'resume': {
      simState.paused = false;
      res.json({ ok: true });
      return;
    }

    case 'step': {
      simState = tickAllMatches(simState);
      res.json({ ok: true });
      return;
    }

    case 'goto': {
      const { matchIndex, state } = params as {
        matchIndex: number;
        state: SimMatchState;
      };
      if (!STATE_ORDER.includes(state)) {
        res.status(400).json({ error: `Invalid state: ${state}` });
        return;
      }
      const match = simState.matches[matchIndex];
      if (!match) {
        res.status(400).json({ error: `Invalid matchIndex: ${matchIndex}` });
        return;
      }
      // Jump to state — reset periodSeconds for active states
      match.state = state;
      match.period = STATE_ORDER.indexOf(state) <= 0 ? 0 : Math.ceil(STATE_ORDER.indexOf(state) / 2);
      match.periodSeconds = state.endsWith('-active') ? 0 : state.endsWith('-break') ? 900 : 0;
      simState.log.push({
        timestamp: Date.now(),
        matchIndex,
        message: `Jumped to ${state}`,
      });
      res.json({ ok: true });
      return;
    }

    case 'speed': {
      const { multiplier } = params as { multiplier: number };
      if (![1, 2, 5, 10, 50].includes(multiplier)) {
        res.status(400).json({ error: `Invalid speed: ${multiplier}` });
        return;
      }
      simState.config.speed = multiplier;
      if (simState.running) {
        startAutoTick(); // restart with new interval
      }
      res.json({ ok: true, speed: multiplier });
      return;
    }

    default:
      res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

// ───── Status endpoint ─────

router.get('/status', (_req, res) => {
  console.log(`[Sim] Status request — running: ${simState.running}, matches: ${simState.matches.length}`);
  res.json({
    running: simState.running,
    paused: simState.paused,
    speed: simState.config.speed,
    matches: simState.matches.map((m) => ({
      matchIndex: m.matchIndex,
      state: m.state,
      homeTeam: m.homeSquadName,
      awayTeam: m.awaySquadName,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      period: m.period,
      periodSeconds: m.periodSeconds,
      tickCount: m.tickCount,
      prismaMatchId: m.prismaMatchId,
    })),
    log: simState.log.slice(-20),
  });
});

export { router as simRouter };
