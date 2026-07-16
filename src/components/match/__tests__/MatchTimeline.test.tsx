import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchTabs } from '@/app/match/[matchId]/MatchTabs';
import { MatchTimeline } from '../MatchTimeline';

vi.mock('@/components/match/MatchPlayByPlay', () => ({
  MatchPlayByPlay: ({ entries, competitionId }: { entries: Array<{ id: string }>; competitionId?: string }) => (
    <div data-competition-id={competitionId}>{entries.map((entry) => <span key={entry.id}>{entry.id}</span>)}</div>
  ),
}));

const homeTeam = { id: 'home', name: 'Vipers', abbreviation: 'VIP', logoUrl: null };
const awayTeam = { id: 'away', name: 'Stars', abbreviation: 'STA', logoUrl: null };

describe('MatchTimeline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not request timeline data until its tab is activated', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [{
          id: 'event-1', period: 4, periodSeconds: 300, eventType: 'goal',
          teamId: 'home', homeScore: 60, awayScore: 55,
        }],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MatchTabs
        hasPlayByPlay
        boxScore={<div>Box score</div>}
        playByPlay={<MatchTimeline matchId="match-1" homeTeam={homeTeam} awayTeam={awayTeam} />}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Play by Play' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/matches/match-1/events?limit=75',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(await screen.findByText('event-1')).toBeInTheDocument();
  });

  it('refetches when an accessible filter changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entries: [], nextCursor: null }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<MatchTimeline matchId="match-1" homeTeam={homeTeam} awayTeam={awayTeam} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Quarter'), { target: { value: '4' } });

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/matches/match-1/events?limit=75&quarter=4',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });

  it('passes canonical edition context into play-by-play profile links', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [{
          id: 'event-1', period: 1, periodSeconds: 10, eventType: 'goal',
          teamId: 'home', homeScore: 1, awayScore: 0,
        }],
        nextCursor: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MatchTimeline
        matchId="match-1"
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        competitionId="ssn-2026"
      />,
    );

    const event = await screen.findByText('event-1');
    expect(event.parentElement).toHaveAttribute('data-competition-id', 'ssn-2026');
  });
});
