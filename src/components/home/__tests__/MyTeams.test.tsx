import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyTeams } from '../MyTeams';

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));
vi.mock('next-auth/react', () => ({ useSession: useSessionMock }));
vi.mock('@/components/ui/ScoreCard', () => ({
  ScoreCard: ({ match }: { match: { id: string } }) => <div>Match {match.id}</div>,
}));

describe('MyTeams', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not request private data for signed-out visitors', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useSessionMock.mockReturnValue({ status: 'unauthenticated' });

    const { container } = render(<MyTeams />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders followed-team content for an authenticated user', async () => {
    useSessionMock.mockReturnValue({ status: 'authenticated' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{
        team: { id: 'team-1', name: 'Vipers', abbreviation: 'VIP', logoUrl: null },
        nextMatch: { id: 'next-match' },
        latestResult: { id: 'latest-result' },
      }],
    }));

    render(<MyTeams />);

    expect(await screen.findByText('Vipers')).toBeInTheDocument();
    expect(screen.getByText('Match next-match')).toBeInTheDocument();
    expect(screen.getByText('Match latest-result')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
