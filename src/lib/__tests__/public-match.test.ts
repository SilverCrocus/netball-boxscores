import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMatchMock } = vi.hoisted(() => ({ findMatchMock: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: { match: { findUnique: findMatchMock } },
  excludeSimData: { isSimulation: false },
}));

import {
  canExposePublicMatchScore,
  resolvePublicMatchAccess,
} from '@/lib/public-match';

function match(overrides: Record<string, unknown> = {}) {
  return {
    id: 'match-1',
    competitionId: 'ssn-2026',
    status: 'COMPLETED',
    resultQuality: 'OFFICIAL_FINAL',
    scheduledAt: new Date('2026-07-04T09:30:00Z'),
    homeTeamId: 'home',
    awayTeamId: 'away',
    isSimulation: false,
    stageId: 'stage-1',
    stage: { isPublished: true },
    competition: {
      id: 'ssn-2026',
      slug: '2026',
      publicationStatus: 'PUBLISHED',
      series: { slug: 'suncorp-super-netball', kind: 'LEAGUE' },
      _count: { entries: 8, matches: 64 },
      dataCoverage: [{ capability: 'FINAL_SCORE', state: 'AVAILABLE' }],
    },
    dataCoverage: [],
    ...overrides,
  };
}

describe('public match access', () => {
  beforeEach(() => findMatchMock.mockReset());

  it('resolves a match only when its edition is public-ready', async () => {
    findMatchMock.mockResolvedValue(match());

    const access = await resolvePublicMatchAccess('match-1');

    expect(access).toMatchObject({ id: 'match-1', competitionId: 'ssn-2026' });
    expect(canExposePublicMatchScore(access!)).toBe(true);
  });

  it.each(['DRAFT', 'ARCHIVED'])('fails closed for a %s edition', async (publicationStatus) => {
    findMatchMock.mockResolvedValue(match({
      competition: {
        ...match().competition,
        publicationStatus,
      },
    }));

    await expect(resolvePublicMatchAccess('match-1')).resolves.toBeNull();
  });

  it('fails closed for a published but unready edition', async () => {
    findMatchMock.mockResolvedValue(match({
      competition: {
        ...match().competition,
        _count: { entries: 0, matches: 0 },
      },
    }));

    await expect(resolvePublicMatchAccess('match-1')).resolves.toBeNull();
  });

  it('fails closed when a match belongs to an unpublished stage', async () => {
    findMatchMock.mockResolvedValue(match({
      stage: { isPublished: false },
    }));

    await expect(resolvePublicMatchAccess('match-1')).resolves.toBeNull();
  });

  it('fails closed for simulation data under the production exclusion policy', async () => {
    findMatchMock.mockResolvedValue(match({ isSimulation: true }));

    await expect(resolvePublicMatchAccess('match-1')).resolves.toBeNull();
  });

  it('allows a legacy public match without a stage', async () => {
    findMatchMock.mockResolvedValue(match({ stageId: null, stage: null }));

    await expect(resolvePublicMatchAccess('match-1')).resolves.not.toBeNull();
  });

  it('does not expose an unknown-quality completed score', async () => {
    findMatchMock.mockResolvedValue(match({ resultQuality: 'UNKNOWN' }));

    const access = await resolvePublicMatchAccess('match-1');

    expect(canExposePublicMatchScore(access!)).toBe(false);
  });

  it('honours a match-level unavailable override', async () => {
    findMatchMock.mockResolvedValue(match({
      dataCoverage: [{ capability: 'FINAL_SCORE', state: 'UNAVAILABLE' }],
    }));

    const access = await resolvePublicMatchAccess('match-1');

    expect(access?.features.finalScore).toMatchObject({
      available: false,
      scope: 'match',
    });
    expect(canExposePublicMatchScore(access!)).toBe(false);
  });

  it('deduplicates only concurrent lookups', async () => {
    let release!: (value: ReturnType<typeof match>) => void;
    findMatchMock.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = resolvePublicMatchAccess('match-concurrent');
    const second = resolvePublicMatchAccess('match-concurrent');
    release(match({ id: 'match-concurrent' }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(findMatchMock).toHaveBeenCalledOnce();
  });

  it('observes publication revocation on the next lookup', async () => {
    findMatchMock
      .mockResolvedValueOnce(match())
      .mockResolvedValueOnce(match({
        competition: {
          ...match().competition,
          publicationStatus: 'DRAFT',
        },
      }));

    await expect(resolvePublicMatchAccess('match-1')).resolves.not.toBeNull();
    await expect(resolvePublicMatchAccess('match-1')).resolves.toBeNull();
    expect(findMatchMock).toHaveBeenCalledTimes(2);
  });
});
