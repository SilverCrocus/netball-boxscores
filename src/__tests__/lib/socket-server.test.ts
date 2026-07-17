import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'http';

const {
  mockEmit,
  mockOn,
  mockTo,
  resolvePublicMatchMock,
} = vi.hoisted(() => {
  const emit = vi.fn();
  return {
    mockEmit: emit,
    mockOn: vi.fn(),
    mockTo: vi.fn(() => ({ emit })),
    resolvePublicMatchMock: vi.fn(),
  };
});

vi.mock('socket.io', () => ({
  Server: class {
    on = mockOn;
    to = mockTo;
  },
}));

vi.mock('@/lib/public-match', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/public-match')>();
  return { ...actual, resolvePublicMatchAccess: resolvePublicMatchMock };
});

import { resolveEditionFeatures } from '@/lib/edition-capabilities';
import type { PublicMatchAccess } from '@/lib/public-match';
import {
  broadcastMatchStatus,
  broadcastScoreFlowAdd,
  broadcastScoreFlowSnapshot,
  broadcastScoreUpdate,
  broadcastStatEvent,
  broadcastStatEventsSnapshot,
  broadcastStatsUpdate,
  initSocketServer,
} from '@/lib/socket-server';

function publicAccess(
  capabilities: Array<
    | 'FINAL_SCORE'
    | 'PLAYER_BOX_SCORE'
    | 'SCORE_FLOW'
    | 'MATCH_EVENTS'
    | 'LINEUPS'
  > = ['FINAL_SCORE', 'PLAYER_BOX_SCORE', 'SCORE_FLOW', 'MATCH_EVENTS'],
  status: 'SCHEDULED' | 'LIVE' | 'COMPLETED' = 'LIVE',
): PublicMatchAccess {
  return {
    id: 'match-1',
    competitionId: 'edition-1',
    status,
    resultQuality: status === 'COMPLETED' ? 'OFFICIAL_FINAL' : 'UNKNOWN',
    scheduledAt: new Date('2026-07-25T09:00:00Z'),
    homeTeamId: 'home',
    awayTeamId: 'away',
    sourceUpdatedAt: new Date('2026-07-25T09:00:01Z'),
    features: resolveEditionFeatures(
      capabilities.map((capability) => ({ capability, state: 'AVAILABLE' as const })),
    ),
  };
}

function connectFakeSocket() {
  const handlers = new Map<string, (data?: { matchId?: string }) => unknown>();
  const socket = {
    id: 'socket-1',
    on: vi.fn((event: string, handler: (data?: { matchId?: string }) => unknown) => {
      handlers.set(event, handler);
    }),
    join: vi.fn(),
    leave: vi.fn(),
  };
  const connectionHandler = mockOn.mock.calls.find(([event]) => event === 'connection')?.[1];
  expect(connectionHandler).toBeTypeOf('function');
  connectionHandler(socket);
  return { handlers, socket };
}

describe('socket-server public safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePublicMatchMock.mockResolvedValue(publicAccess());
    initSocketServer(createServer());
  });

  it.each([
    ['score:update', broadcastScoreUpdate, 'FINAL_SCORE'],
    ['match:status', broadcastMatchStatus, 'FINAL_SCORE'],
    ['stats:update', broadcastStatsUpdate, 'PLAYER_BOX_SCORE'],
    ['scoreflow:add', broadcastScoreFlowAdd, 'SCORE_FLOW'],
    ['scoreflow:snapshot', broadcastScoreFlowSnapshot, 'SCORE_FLOW'],
    ['stat:event', broadcastStatEvent, 'MATCH_EVENTS'],
    ['stat:snapshot', broadcastStatEventsSnapshot, 'MATCH_EVENTS'],
  ] as const)('maps %s to its required capability', async (event, broadcaster, capability) => {
    const payload = event === 'stats:update'
      ? { matchId: 'match-1', playerStats: [] }
      : event === 'scoreflow:snapshot'
        ? { matchId: 'match-1', entries: [] }
        : event === 'stat:snapshot'
          ? { matchId: 'match-1', events: [] }
          : { matchId: 'match-1' };

    resolvePublicMatchMock.mockResolvedValue(publicAccess([capability]));
    await expect(broadcaster('match-1', payload as never, publicAccess([capability]))).resolves.toBe(true);
    expect(mockTo).toHaveBeenCalledWith('match:match-1');
    expect(mockEmit).toHaveBeenCalledWith(event, {
      ...payload,
      revision: '2026-07-25T09:00:01.000Z',
    });

    mockTo.mockClear();
    mockEmit.mockClear();
    resolvePublicMatchMock.mockResolvedValue(publicAccess([]));
    await expect(broadcaster('match-1', payload as never, publicAccess([]))).resolves.toBe(false);
    expect(mockTo).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('rechecks publication at emit time and fails closed after revocation', async () => {
    resolvePublicMatchMock.mockResolvedValue(null);

    await expect(broadcastScoreUpdate(
      'match-1',
      { matchId: 'match-1' } as never,
      publicAccess(['FINAL_SCORE']),
    )).resolves.toBe(false);

    expect(mockTo).not.toHaveBeenCalled();
  });

  it('does not trust a stale supplied capability snapshot at the final emit boundary', async () => {
    resolvePublicMatchMock.mockResolvedValue(publicAccess([]));

    await expect(broadcastStatsUpdate(
      'match-1',
      { matchId: 'match-1' } as never,
      publicAccess(['PLAYER_BOX_SCORE']),
    )).resolves.toBe(false);

    expect(resolvePublicMatchMock).toHaveBeenCalledWith('match-1');
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('strips lineup positions when LINEUPS is revoked before the final emit check', async () => {
    resolvePublicMatchMock.mockResolvedValue(publicAccess(['PLAYER_BOX_SCORE']));

    await expect(broadcastStatsUpdate(
      'match-1',
      {
        matchId: 'match-1',
        playerStats: [{ playerId: 'player-1', currentPosition: 'GS' }],
      } as never,
      publicAccess(['PLAYER_BOX_SCORE', 'LINEUPS']),
    )).resolves.toBe(true);

    expect(mockEmit).toHaveBeenCalledWith(
      'stats:update',
      expect.objectContaining({
        playerStats: [expect.not.objectContaining({ currentPosition: 'GS' })],
      }),
    );
  });

  it('suppresses a payload from an older canonical revision', async () => {
    resolvePublicMatchMock.mockResolvedValue(publicAccess(['FINAL_SCORE']));

    await expect(broadcastScoreUpdate(
      'match-1',
      { matchId: 'match-1' } as never,
      publicAccess(['FINAL_SCORE']),
      '2026-07-25T09:00:00.000Z',
    )).resolves.toBe(false);

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('joins a bounded room only for a public live match with score and detail coverage', async () => {
    const { handlers, socket } = connectFakeSocket();

    await handlers.get('match:subscribe')?.({ matchId: 'match-1' });
    await handlers.get('match:subscribe')?.({ matchId: 'match-2' });

    expect(socket.join).toHaveBeenNthCalledWith(1, 'match:match-1');
    expect(socket.leave).toHaveBeenCalledWith('match:match-1');
    expect(socket.join).toHaveBeenNthCalledWith(2, 'match:match-2');
  });

  it.each([
    ['unpublished', null],
    ['scheduled', publicAccess(undefined, 'SCHEDULED')],
    ['missing final score', publicAccess(['PLAYER_BOX_SCORE'])],
    ['missing realtime detail', publicAccess(['FINAL_SCORE'])],
  ])('refuses a %s subscription', async (_label, access) => {
    resolvePublicMatchMock.mockResolvedValue(access);
    const { handlers, socket } = connectFakeSocket();

    await handlers.get('match:subscribe')?.({ matchId: 'match-1' });

    expect(socket.join).not.toHaveBeenCalled();
  });

  it('fails closed when public access resolution rejects', async () => {
    resolvePublicMatchMock.mockRejectedValue(new Error('database unavailable'));
    const { handlers, socket } = connectFakeSocket();

    await handlers.get('match:subscribe')?.({ matchId: 'match-1' });

    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { matchId: '' },
    { matchId: 'x'.repeat(129) },
  ])('ignores an invalid subscription payload %#', async (payload) => {
    const { handlers, socket } = connectFakeSocket();

    await handlers.get('match:subscribe')?.(payload as { matchId?: string });

    expect(resolvePublicMatchMock).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('does not join after unsubscribe wins an async access race', async () => {
    let release!: (access: ReturnType<typeof publicAccess>) => void;
    resolvePublicMatchMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { handlers, socket } = connectFakeSocket();

    const pending = handlers.get('match:subscribe')?.({ matchId: 'match-1' });
    handlers.get('match:unsubscribe')?.({ matchId: 'match-1' });
    release(publicAccess());
    await pending;

    expect(socket.leave).toHaveBeenCalledWith('match:match-1');
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('does not join after disconnect wins an async access race', async () => {
    let release!: (access: ReturnType<typeof publicAccess>) => void;
    resolvePublicMatchMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { handlers, socket } = connectFakeSocket();

    const pending = handlers.get('match:subscribe')?.({ matchId: 'match-1' });
    handlers.get('disconnect')?.();
    release(publicAccess());
    await pending;

    expect(socket.join).not.toHaveBeenCalled();
  });
});
