import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { resolveOfficialLiveCentreUrlMock } = vi.hoisted(() => ({
  resolveOfficialLiveCentreUrlMock: vi.fn(),
}));

vi.mock('@/lib/glasgow/official-results-link', () => ({
  resolveOfficialGlasgowLiveCentreUrl: resolveOfficialLiveCentreUrlMock,
}));

import {
  OfficialLiveCentreResolver,
} from '@/components/match/OfficialLiveCentreResolver';

const src = 'https://crs-cg2026.glasgow2026.com/#/team-players/'
  + 'NBL/W/TEAM7-------------/GPA-/000400--';

describe('OfficialLiveCentreResolver', () => {
  it('renders the official frame when the fixture resolves', async () => {
    resolveOfficialLiveCentreUrlMock.mockResolvedValue(src);

    render(await OfficialLiveCentreResolver({
      scheduledAt: new Date('2026-07-26T10:00:00Z'),
      homeTeamAbbreviation: 'AUS',
      awayTeamAbbreviation: 'ENG',
      isLive: true,
    }));

    expect(resolveOfficialLiveCentreUrlMock).toHaveBeenCalledWith({
      scheduledAt: new Date('2026-07-26T10:00:00Z'),
      homeTeamAbbreviation: 'AUS',
      awayTeamAbbreviation: 'ENG',
    });
    expect(screen.getByTitle(
      'Official Glasgow 2026 player statistics and play-by-play',
    )).toHaveAttribute('src', src);
  });

  it('renders nothing when no unique official fixture resolves', async () => {
    resolveOfficialLiveCentreUrlMock.mockResolvedValue(null);

    expect(await OfficialLiveCentreResolver({
      scheduledAt: new Date('2026-07-26T10:00:00Z'),
      homeTeamAbbreviation: 'AUS',
      awayTeamAbbreviation: 'ENG',
      isLive: false,
    })).toBeNull();
  });
});
