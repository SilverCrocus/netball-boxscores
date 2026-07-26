import { describe, expect, it, vi } from 'vitest';
import type { OfficialFeedObservation } from '@/lib/glasgow/official-feed';
import {
  officialDetailedResultsUrl,
  resolveOfficialGlasgowLiveCentreUrl,
} from '@/lib/glasgow/official-results-link';

const observation: OfficialFeedObservation = {
  provider: 'COMMONWEALTH_SPORT',
  providerCompetitionId: '3bb0d78e-d439-472a-a5bf-09b4e888aa04',
  providerMatchCode: 'NBLWTEAM7-------------GPA-000400--',
  providerSessionId: 'session-1',
  providerEventCode: 'TEAM7-------------',
  providerPhaseCode: 'GPA-',
  providerGenderCode: 'W',
  providerDisciplineCode: 'NBL',
  providerSideAResultId: 'result-a',
  providerSideBResultId: 'result-b',
  detailRequestUrl: 'https://api.commonwealthsport.com/example',
  startDate: '2026-07-26T10:00:00Z',
  endDate: '2026-07-26T11:45:00Z',
  status: 'COMPLETED',
  resultQuality: 'OFFICIAL_FINAL',
  sideAOrganisationCode: 'AUS',
  sideBOrganisationCode: 'ENG',
  sideAScore: 66,
  sideBScore: 47,
};

describe('official Glasgow detailed-results links', () => {
  it('builds a narrow official player-stats route from the verified provider code', () => {
    expect(officialDetailedResultsUrl(observation)).toBe(
      'https://crs-cg2026.glasgow2026.com/#/team-players/NBL/W/'
        + 'TEAM7-------------/GPA-/000400--',
    );
  });

  it('rejects a provider match code that does not match its typed route fields', () => {
    expect(officialDetailedResultsUrl({
      ...observation,
      providerMatchCode: 'NBLWTEAM7-------------GPB-000400--',
    })).toBeNull();
  });

  it('resolves exactly one observation by London start time and ordered teams', async () => {
    const fetchObservations = vi.fn().mockResolvedValue([
      observation,
      {
        ...observation,
        providerMatchCode: 'NBLWTEAM7-------------GPB-000400--',
        providerPhaseCode: 'GPB-',
        sideAOrganisationCode: 'WAL',
        sideBOrganisationCode: 'SCO',
        startDate: '2026-07-26T08:00:00Z',
      },
    ]);

    await expect(resolveOfficialGlasgowLiveCentreUrl({
      scheduledAt: new Date('2026-07-26T10:00:00Z'),
      homeTeamAbbreviation: 'AUS',
      awayTeamAbbreviation: 'ENG',
    }, { fetchObservations })).resolves.toBe(
      'https://crs-cg2026.glasgow2026.com/#/team-players/NBL/W/'
        + 'TEAM7-------------/GPA-/000400--',
    );
    expect(fetchObservations).toHaveBeenCalledWith('2026-07-26');
  });

  it.each([
    {
      providerHome: 'MAW',
      providerAway: 'WAL',
      storedHome: 'MWI',
      storedAway: 'WAL',
    },
    {
      providerHome: 'WAL',
      providerAway: 'MAW',
      storedHome: 'WAL',
      storedAway: 'MWI',
    },
    {
      providerHome: 'TGA',
      providerAway: 'SCO',
      storedHome: 'TON',
      storedAway: 'SCO',
    },
    {
      providerHome: 'SCO',
      providerAway: 'TGA',
      storedHome: 'SCO',
      storedAway: 'TON',
    },
  ])(
    'normalizes official aliases for $providerHome vs $providerAway',
    async ({
      providerHome,
      providerAway,
      storedHome,
      storedAway,
    }) => {
      await expect(resolveOfficialGlasgowLiveCentreUrl({
        scheduledAt: new Date(observation.startDate),
        homeTeamAbbreviation: storedHome,
        awayTeamAbbreviation: storedAway,
      }, {
        fetchObservations: vi.fn().mockResolvedValue([{
          ...observation,
          sideAOrganisationCode: providerHome,
          sideBOrganisationCode: providerAway,
        }]),
      })).resolves.toBe(
        'https://crs-cg2026.glasgow2026.com/#/team-players/NBL/W/'
          + 'TEAM7-------------/GPA-/000400--',
      );
    },
  );

  it('fails closed when the provider response is missing or ambiguous', async () => {
    const input = {
      scheduledAt: new Date('2026-07-26T10:00:00Z'),
      homeTeamAbbreviation: 'AUS',
      awayTeamAbbreviation: 'ENG',
    };

    await expect(resolveOfficialGlasgowLiveCentreUrl(input, {
      fetchObservations: vi.fn().mockResolvedValue([]),
    })).resolves.toBeNull();
    await expect(resolveOfficialGlasgowLiveCentreUrl(input, {
      fetchObservations: vi.fn().mockResolvedValue([observation, { ...observation }]),
    })).resolves.toBeNull();
  });
});
