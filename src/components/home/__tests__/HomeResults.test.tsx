import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeResults } from '../HomeResults';
import type { HomeResultCard } from '@/lib/home-feed';

function result(id: string, round: number): HomeResultCard {
  return {
    id,
    competitionId: 'ssn-2026',
    status: 'COMPLETED',
    scoreAvailable: true,
    scheduledAt: '2026-06-01T04:00:00.000Z',
    homeScore: 62,
    awayScore: 58,
    venue: 'Arena',
    round,
    roundLabel: null,
    stageName: null,
    finalCode: null,
    homeTeam: { name: `Vipers ${id}`, abbreviation: 'VIP', logoUrl: null },
    awayTeam: { name: `Stars ${id}`, abbreviation: 'STA', logoUrl: null },
    homeBreakdown: null,
    awayBreakdown: null,
  };
}

describe('HomeResults', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads and announces earlier results without replacing the current page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [{ label: 'Round 9', matches: [result('earlier-match', 9)] }],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <HomeResults
        initialGroups={[{ label: 'Round 10', matches: [result('latest-match', 10)] }]}
        initialNextCursor="cursor-1"
        season={2026}
        editionId="ssn-2026"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View previous rounds' }));

    expect(await screen.findByRole('link', {
      name: /Vipers earlier-match 62, Stars earlier-match 58.*View match stats/i,
    })).toHaveAttribute('href', '/match/earlier-match?edition=ssn-2026');
    expect(screen.getByRole('link', {
      name: /Vipers latest-match 62, Stars latest-match 58.*View match stats/i,
    })).toHaveAttribute('href', '/match/latest-match?edition=ssn-2026');
    expect(screen.getByText('1 earlier result added.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/matches?edition=ssn-2026&season=2026&cursor=cursor-1');
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });

  it('keeps a retry action available after a request failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
    render(
      <HomeResults
        initialGroups={[{ label: 'Round 10', matches: [result('latest-match', 10)] }]}
        initialNextCursor="cursor-1"
        season={2026}
        editionId="ssn-2026"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View previous rounds' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByRole('button', { name: 'Try earlier results again' })).toBeEnabled();
  });

  it('keeps a continuation reachable when a bounded scan returns no visible groups', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        groups: [{ label: 'Round 1', matches: [result('older-public-match', 1)] }],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <HomeResults
        initialGroups={[]}
        initialNextCursor="denied-scan-cursor"
        season={2026}
        editionId="ssn-2026"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View previous rounds' }));

    expect(await screen.findByRole('link', {
      name: /Vipers older-public-match 62, Stars older-public-match 58.*View match stats/i,
    })).toHaveAttribute('href', '/match/older-public-match?edition=ssn-2026');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/matches?edition=ssn-2026&season=2026&cursor=denied-scan-cursor',
    );
  });

  it('renders compact result rows with canonical and explicit match links', () => {
    const hosted = {
      ...result('hosted-match', 10),
      competitionId: undefined,
      href: '/match/hosted-match?edition=glasgow-2026',
    };

    render(
      <HomeResults
        initialGroups={[{
          label: 'Round 10',
          matches: [result('local-match', 10), hosted],
        }]}
        initialNextCursor={null}
        season={2026}
        editionId="ssn-2026"
      />,
    );

    expect(screen.getByRole('list', { name: 'Round 10 results' })).toBeInTheDocument();
    expect(screen.getByRole('link', {
      name: /Vipers local-match 62, Stars local-match 58.*View match stats/i,
    })).toHaveAttribute('href', '/match/local-match?edition=ssn-2026');
    expect(screen.getByRole('link', {
      name: /Vipers hosted-match 62, Stars hosted-match 58.*View match stats/i,
    })).toHaveAttribute('href', '/match/hosted-match?edition=glasgow-2026');
  });
});
