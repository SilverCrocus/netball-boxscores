import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerPage from '../page';
import { getPublicCompetitions } from '@/lib/competitions';
import { prisma } from '@/lib/db';
import { getPlayerAnalyticsProfile } from '@/lib/player-analytics';

const { heroSpy } = vi.hoisted(() => ({ heroSpy: vi.fn() }));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/competitions', () => ({
  getPublicCompetitions: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    player: { findFirst: vi.fn() },
    scoreFlow: { groupBy: vi.fn() },
  },
}));

vi.mock('@/lib/player-analytics', () => ({
  getPlayerAnalyticsProfile: vi.fn(),
}));

vi.mock('@/components/player/PlayerHero', () => ({
  PlayerHero: (props: { player: { position: string; team: { name: string } } }) => {
    heroSpy(props);
    return (
      <div data-testid="player-hero">
        {props.player.team.name} · {props.player.position}
      </div>
    );
  },
}));

vi.mock('@/components/player/PlayerBioCard', () => ({
  PlayerBioCard: () => <div data-testid="player-bio" />,
}));

vi.mock('@/components/player/PlayerSeasonStats', () => ({
  default: () => <div data-testid="season-stats" />,
}));

vi.mock('@/components/player/PlayerCharts', () => ({
  default: () => <div data-testid="player-charts" />,
}));

vi.mock('@/components/player/PlayerGameLog', () => ({
  PlayerGameLog: () => <div data-testid="game-log" />,
}));

vi.mock('@/components/player/PlayerAdvancedMetrics', () => ({
  PlayerAdvancedMetrics: () => <div data-testid="advanced-metrics" />,
}));

const glasgowEdition = {
  id: 'glasgow-id',
  season: 2026,
  name: 'Commonwealth Games Netball',
  slug: '2026',
  label: 'Glasgow 2026',
  publicationStatus: 'PUBLISHED',
  series: {
    id: 'commonwealth-games-id',
    slug: 'commonwealth-games-netball',
    name: 'Commonwealth Games Netball',
    kind: 'TOURNAMENT',
  },
};

const ssnEdition = {
  id: 'ssn-id',
  season: 2026,
  name: 'Suncorp Super Netball',
  slug: '2026',
  label: 'SSN 2026',
  publicationStatus: 'PUBLISHED',
  series: {
    id: 'ssn-series-id',
    slug: 'ssn',
    name: 'Suncorp Super Netball',
    kind: 'LEAGUE',
  },
};

const publicEditions = [glasgowEdition, ssnEdition] as never;

const clubTeam = {
  id: 'club-team-id',
  name: 'Adelaide Thunderbirds',
  slug: 'adelaide-thunderbirds',
  logoUrl: null,
  primaryColor: '#e91e63',
};

const jamaicaTeam = {
  id: 'jamaica-team-id',
  name: 'Jamaica',
  slug: 'jamaica',
  logoUrl: null,
  primaryColor: '#ffcd00',
};

function playerFor(position: 'C' | 'WD') {
  const isGlasgow = position === 'WD';
  return {
    id: 'canonical-player-id',
    name: 'Canonical Player',
    position: 'C',
    teamId: clubTeam.id,
    team: clubTeam,
    photoUrl: null,
    photoSourceUrl: null,
    photoCredit: null,
    photoLicense: null,
    nationality: 'Jamaican',
    dateOfBirth: null,
    height: null,
    biography: null,
    matchStats: [],
    rosterMemberships: [
      {
        designatedPosition: position,
        editionEntry: {
          displayName: isGlasgow ? 'Jamaica' : 'Adelaide Thunderbirds',
          team: isGlasgow ? jamaicaTeam : clubTeam,
          competition: isGlasgow ? glasgowEdition : ssnEdition,
        },
      },
    ],
  };
}

describe('PlayerPage edition context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPublicCompetitions).mockResolvedValue(publicEditions);
    vi.mocked(prisma.scoreFlow.groupBy).mockResolvedValue([]);
    vi.mocked(getPlayerAnalyticsProfile).mockResolvedValue({
      superShotMatchIds: [],
    } as never);
    vi.mocked(prisma.player.findFirst).mockResolvedValue(playerFor('C') as never);
  });

  it('uses Glasgow roster position instead of the canonical SSN position everywhere', async () => {
    vi.mocked(prisma.player.findFirst).mockResolvedValueOnce(playerFor('WD') as never);

    const page = await PlayerPage({
      params: Promise.resolve({ playerId: 'canonical-player-id' }),
      searchParams: Promise.resolve({ edition: 'glasgow-id' }),
    });
    render(page);

    expect(screen.getByTestId('player-hero')).toHaveTextContent('Jamaica · WD');
    expect(heroSpy).toHaveBeenCalledWith(expect.objectContaining({
      player: expect.objectContaining({ position: 'WD', team: jamaicaTeam }),
      positionConfig: expect.objectContaining({ group: 'midcourt' }),
      editionId: 'glasgow-id',
    }));
    expect(getPlayerAnalyticsProfile).toHaveBeenCalledWith(
      'canonical-player-id',
      'glasgow-id',
      'WD',
    );
    expect(prisma.player.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        rosterMemberships: expect.objectContaining({
          where: { editionEntry: { competitionId: 'glasgow-id' } },
        }),
      }),
    }));

    const personJsonLd = document.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    );
    expect(personJsonLd?.textContent).toContain('"jobTitle":"WD"');
    expect(personJsonLd?.textContent).toContain('"name":"Jamaica"');
  });

  it('uses the latest public edition as the sensible no-query default', async () => {
    vi.mocked(prisma.player.findFirst).mockResolvedValueOnce(playerFor('WD') as never);

    await PlayerPage({
      params: Promise.resolve({ playerId: 'canonical-player-id' }),
      searchParams: Promise.resolve({}),
    });

    expect(getPlayerAnalyticsProfile).toHaveBeenCalledWith(
      'canonical-player-id',
      'glasgow-id',
      'WD',
    );
  });

  it('accepts a competition-qualified edition slug without global guessing', async () => {
    vi.mocked(prisma.player.findFirst).mockResolvedValueOnce(playerFor('WD') as never);

    await PlayerPage({
      params: Promise.resolve({ playerId: 'canonical-player-id' }),
      searchParams: Promise.resolve({
        competition: 'commonwealth-games-netball',
        edition: '2026',
      }),
    });

    expect(getPlayerAnalyticsProfile).toHaveBeenCalledWith(
      'canonical-player-id',
      'glasgow-id',
      'WD',
    );
  });

  it('retains the SSN roster position when SSN is selected', async () => {
    const page = await PlayerPage({
      params: Promise.resolve({ playerId: 'canonical-player-id' }),
      searchParams: Promise.resolve({ edition: 'ssn-id' }),
    });
    render(page);

    expect(screen.getByTestId('player-hero')).toHaveTextContent('Adelaide Thunderbirds · C');
    expect(getPlayerAnalyticsProfile).toHaveBeenCalledWith(
      'canonical-player-id',
      'ssn-id',
      'C',
    );
  });

  it('keeps legacy year selection league-scoped without confusing the tournament', async () => {
    await PlayerPage({
      params: Promise.resolve({ playerId: 'canonical-player-id' }),
      searchParams: Promise.resolve({ season: '2026' }),
    });

    expect(getPlayerAnalyticsProfile).toHaveBeenCalledWith(
      'canonical-player-id',
      'ssn-id',
      'C',
    );
  });

  it.each([
    { selection: { edition: '2026' }, label: 'ambiguous slug' },
    { selection: { edition: 'missing-id' }, label: 'unknown edition' },
    { selection: { season: '2099' }, label: 'unknown year' },
  ])('404s an invalid $label instead of querying the latest edition', async ({ selection }) => {
    await expect(PlayerPage({
      params: Promise.resolve({ playerId: 'canonical-player-id' }),
      searchParams: Promise.resolve(selection),
    })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(prisma.player.findFirst).not.toHaveBeenCalled();
    expect(getPlayerAnalyticsProfile).not.toHaveBeenCalled();
  });
});
