import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch } from '../GlobalSearch';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for two characters and debounces requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        players: [],
        teams: [{ id: 'team-1', kind: 'team', label: 'Melbourne Vixens', meta: 'VIX', href: '/team/melbourne-vixens' }],
        matches: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<GlobalSearch />);
    const input = screen.getByRole('combobox', { name: 'Search players, teams, and matches' });

    fireEvent.change(input, { target: { value: 'v' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'vi' } });
    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/search?q=vi',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    vi.useRealTimers();
    expect(await screen.findByRole('option', { name: /Melbourne Vixens/ })).toBeInTheDocument();
  });

  it('supports keyboard selection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        players: [{ id: 'player-1', kind: 'player', label: 'Vix Player', meta: 'C', href: '/player/player-1' }],
        teams: [],
        matches: [],
      }),
    }));
    render(<GlobalSearch />);
    const input = screen.getByRole('combobox', { name: 'Search players, teams, and matches' });
    fireEvent.change(input, { target: { value: 'vix' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    vi.useRealTimers();
    expect(await screen.findByRole('option', { name: /Vix Player/ })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(pushMock).toHaveBeenCalledWith('/player/player-1');
  });
});
