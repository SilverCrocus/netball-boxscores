import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeResults } from '../HomeResults';
import type { HomeResultCard } from '@/lib/home-feed';

vi.mock('@/components/ui/ScoreCard', () => ({
  ScoreCard: ({ match }: { match: { id: string } }) => <div>{match.id}</div>,
}));

function result(id: string, round: number): HomeResultCard {
  return {
    id,
    status: 'COMPLETED',
    scheduledAt: '2026-06-01T04:00:00.000Z',
    homeScore: 62,
    awayScore: 58,
    venue: 'Arena',
    round,
    finalCode: null,
    homeTeam: { name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
    awayTeam: { name: 'Stars', abbreviation: 'STA', logoUrl: null },
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
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View previous rounds' }));

    expect(await screen.findByText('earlier-match')).toBeInTheDocument();
    expect(screen.getByText('latest-match')).toBeInTheDocument();
    expect(screen.getByText('1 earlier result added.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/matches?season=2026&cursor=cursor-1');
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });

  it('keeps a retry action available after a request failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));
    render(
      <HomeResults
        initialGroups={[{ label: 'Round 10', matches: [result('latest-match', 10)] }]}
        initialNextCursor="cursor-1"
        season={2026}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'View previous rounds' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByRole('button', { name: 'Try earlier results again' })).toBeEnabled();
  });
});
