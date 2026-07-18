import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchActions } from '../MatchActions';

const { pushMock, useSessionMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  useSessionMock: vi.fn(),
}));

vi.mock('next-auth/react', () => ({ useSession: useSessionMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

describe('MatchActions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends signed-out users to sign in with a callback', () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' });
    render(<MatchActions matchId="match-1" status="SCHEDULED" competitionId="ssn-2026" />);

    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }));

    expect(pushMock).toHaveBeenCalledWith(
      '/auth/signin?callbackUrl=%2Fmatch%2Fmatch-1%3Fedition%3Dssn-2026',
    );
  });

  it('preserves the canonical edition in the sign-in callback', () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated' });
    render(<MatchActions matchId="match-1" status="SCHEDULED" competitionId="ssn-2026" />);

    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }));

    expect(pushMock).toHaveBeenCalledWith(
      '/auth/signin?callbackUrl=%2Fmatch%2Fmatch-1%3Fedition%3Dssn-2026',
    );
  });

  it('optimistically favourites a match and rolls back on failure', async () => {
    useSessionMock.mockReturnValue({ status: 'authenticated' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchActions matchId="match-1" status="SCHEDULED" competitionId="ssn-2026" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Favourite' }));
    expect(screen.getByRole('button', { name: 'Favourited' })).toHaveAttribute('aria-pressed', 'true');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add this favourite');
    expect(screen.getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'false');
  });
});
