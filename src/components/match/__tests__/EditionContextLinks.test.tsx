import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LivePlayByPlay } from '@/components/match/LivePlayByPlay';
import { MatchPlayByPlay } from '@/components/match/MatchPlayByPlay';

const homeTeam = {
  id: 'home-team',
  name: 'Thunder',
  abbreviation: 'THU',
  logoUrl: null,
};

const awayTeam = {
  id: 'away-team',
  name: 'Lightning',
  abbreviation: 'LIG',
  logoUrl: null,
};

describe('match edition context links', () => {
  it('scopes completed match play-by-play player links to the match edition', () => {
    render(
      <MatchPlayByPlay
        competitionId="ssn-2026"
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        entries={[{
          id: 'event-1',
          period: 1,
          periodSeconds: 10,
          eventType: 'intercept',
          teamId: homeTeam.id,
          playerId: 'player-1',
          playerName: 'Alex Defender',
        }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Alex Defender' })).toHaveAttribute(
      'href',
      '/player/player-1?edition=ssn-2026',
    );
  });

  it('scopes live scorer and event player links to the match edition', () => {
    render(
      <LivePlayByPlay
        competitionId="glasgow-2026"
        entries={[
          {
            time: '1:10',
            quarter: 1,
            eventType: 'goal',
            scorerName: 'Goal Shooter',
            scorerPlayerId: 'shooter-1',
            teamAbbreviation: homeTeam.abbreviation,
            teamName: homeTeam.name,
            teamLogoUrl: null,
            isHomeTeam: true,
            homeScore: 1,
            awayScore: 0,
          },
          {
            time: '1:20',
            quarter: 1,
            eventType: 'intercept',
            playerName: 'Wing Defence',
            playerId: 'defender-1',
            teamAbbreviation: awayTeam.abbreviation,
            teamName: awayTeam.name,
            teamLogoUrl: null,
            isHomeTeam: false,
          },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Goal Shooter' })).toHaveAttribute(
      'href',
      '/player/shooter-1?edition=glasgow-2026',
    );
    expect(screen.getByRole('link', { name: 'Wing Defence' })).toHaveAttribute(
      'href',
      '/player/defender-1?edition=glasgow-2026',
    );
  });
});
