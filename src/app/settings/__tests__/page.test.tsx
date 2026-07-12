import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../page';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { email: 'maya@example.com' } },
    status: 'authenticated',
  }),
}));

function response(payload: unknown, ok = true) {
  return { ok, json: async () => payload };
}

describe('SettingsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('optimistically follows a team and exposes pressed state', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(response({ teamId: 'team-1' }));
      if (url === '/api/teams') {
        return Promise.resolve(response([{ id: 'team-1', name: 'Vipers', abbreviation: 'VIP', logoUrl: null }]));
      }
      return Promise.resolve(response([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsPage />);

    const teamButton = await screen.findByRole('button', { name: /Vipers/ });
    expect(teamButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(teamButton);

    expect(teamButton).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/user/teams', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ teamId: 'team-1' }),
    })));
  });

  it('renders favourite and reminder lists with honest reminder copy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url === '/api/teams' || url === '/api/user/teams') return Promise.resolve(response([]));
      const resource = {
        matchId: 'match-1',
        match: {
          id: 'match-1', status: 'SCHEDULED', scheduledAt: '2026-07-20T04:00:00Z',
          homeScore: 0, awayScore: 0,
          homeTeam: { name: 'Vipers' }, awayTeam: { name: 'Stars' },
        },
      };
      return Promise.resolve(response([resource]));
    }));
    render(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: 'Favourite matches' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Match reminders' })).toBeInTheDocument();
    expect(screen.getByText(/These are in-app reminders/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Vipers v Stars/ })).toHaveLength(2);
  });
});
