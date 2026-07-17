import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlasgowDraftPreview } from '@/components/admin/GlasgowDraftPreview';

const team = { id: 'aus', name: 'Australia', slug: 'australia', abbreviation: 'AUS', logoUrl: null };

describe('GlasgowDraftPreview', () => {
  it('renders an obvious private warning, flags and roster counts without public entity links or zero scores', () => {
    render(<GlasgowDraftPreview data={{
      edition: {
        id: 'glasgow-edition-id',
        name: 'Commonwealth Games Netball',
        label: 'Glasgow 2026',
        publicationStatus: 'DRAFT',
        unpublishedStageCount: 4,
      },
      schedule: {
        editionId: 'glasgow-edition-id',
        competitionName: 'Commonwealth Games Netball',
        editionLabel: 'Glasgow 2026',
        competitionKind: 'TOURNAMENT',
        sourceTimezone: 'Europe/London',
        timezoneLabel: 'BST',
        summary: {
          fixtureCount: 38,
          teamCount: 12,
          stageCount: 4,
          scheduledCount: 38,
          liveCount: 0,
          completedCount: 0,
          dateRangeLabel: '25 Jul 2026 – 2 Aug 2026',
        },
        stages: [{
          id: 'pool-stage',
          slug: 'pool-stage',
          name: 'Pool Stage',
          type: 'POOL',
          sequence: 1,
          fixtureCount: 1,
          dates: [{
            key: '2026-07-25',
            label: 'Saturday, 25 July 2026',
            fixtures: [{
              id: 'match-1',
              scheduledAt: new Date('2026-07-25T08:00:00Z'),
              localDateLabel: 'Saturday, 25 July 2026',
              localTimeLabel: '09:00 BST',
              status: 'SCHEDULED',
              statusLabel: 'Scheduled',
              resultQuality: 'UNKNOWN',
              venue: 'The Hydro',
              neutralVenue: true,
              contextLabel: 'Pool A',
              sideA: { side: 'A', displayName: 'Australia', team, resolved: true },
              sideB: { side: 'B', displayName: 'Qualifier', team: null, resolved: false },
              score: null,
              href: '/match/match-1?edition=glasgow-edition-id',
            }],
          }],
        }],
      },
      pools: null,
      bracket: [],
      rosters: [{
        id: 'entry-aus',
        seed: 1,
        displayName: 'Australia',
        primaryGroup: { id: 'pool-a', name: 'Pool A' },
        team,
        roster: [{
          id: 'roster-1',
          bib: 'C',
          designatedPosition: 'C',
          isCaptain: true,
          player: { id: 'player-1', name: 'Example Player', position: 'C', nationality: 'Australia' },
        }],
      }],
      activeRosterCount: 96,
    }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Private DRAFT preview');
    expect(screen.getAllByAltText('Australia flag').length).toBeGreaterThan(0);
    expect(screen.getByText('96')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByText('Private preview only')).toBeInTheDocument();
  });
});
