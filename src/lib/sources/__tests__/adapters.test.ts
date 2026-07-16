import { describe, expect, it } from 'vitest';
import { JsonCompetitionAdapter, ManualCompetitionAdapter } from '@/lib/sources/adapter';
import { CsvCompetitionAdapter, parseCsv } from '@/lib/sources/csv-adapter';
import { sourcePayloadChecksum } from '@/lib/sources/checksum';
import { validImport } from '@/lib/sources/__tests__/fixtures';

describe('competition source adapters', () => {
  it('normalizes JSON and manual input without changing the source object', async () => {
    const source = validImport();
    const manual = await new ManualCompetitionAdapter().normalize(source);
    const json = await new JsonCompetitionAdapter().normalize(JSON.stringify(source));

    expect(manual).toEqual(source);
    expect(json).toEqual(source);
    expect(sourcePayloadChecksum(manual)).toBe(sourcePayloadChecksum(json));
    expect(manual).not.toBe(source);
  });

  it('parses quoted CSV values and all launch-critical collections', async () => {
    expect(parseCsv('id,name\n1,"Glasgow, Scotland"')).toEqual([
      { id: '1', name: 'Glasgow, Scotland' },
    ]);

    const normalized = await new CsvCompetitionAdapter().normalize({
      context: validImport().context,
      teams: 'externalId,name,slug,abbreviation,groupSlug,seed,status\nAUS,Australia,australia,AUS,pool-a,1,ACTIVE\nNZL,New Zealand,new-zealand,NZL,pool-b,2,ACTIVE',
      players: 'externalId,teamExternalId,name,position,photoUrl,photoSourceUrl,photoCredit,photoLicense,photoVerifiedAt\np1,AUS,Test Player,C,https://cdn.example.test/player.jpg,https://example.test/media/player,Example Photographer,CC BY 4.0,2026-07-16T00:00:00Z',
      rosters: 'teamExternalId,playerExternalId,status,bib,isCaptain\nAUS,p1,ACTIVE,C,true',
      matches: 'externalId,stageSlug,groupSlug,scheduledAt,venue,neutralVenue,round,sideATeamExternalId,sideASourceType,sideBTeamExternalId,sideBSourceType\nm1,pool-stage,pool-a,2026-07-25T08:00:00Z,SEC,true,1,AUS,TEAM,NZL,TEAM',
      results: 'matchExternalId,status,sideAScore,sideBScore\nm1,COMPLETED,60,55',
      coverage: 'capability,state\nFINAL_SCORE,AVAILABLE',
    });

    expect(normalized).toMatchObject({
      teams: [
        { externalId: 'AUS', groupSlug: 'pool-a', seed: 1, status: 'ACTIVE' },
        { externalId: 'NZL', groupSlug: 'pool-b', seed: 2, status: 'ACTIVE' },
      ],
      players: [{
        externalId: 'p1',
        position: 'C',
        photoUrl: 'https://cdn.example.test/player.jpg',
        photoSourceUrl: 'https://example.test/media/player',
        photoCredit: 'Example Photographer',
        photoLicense: 'CC BY 4.0',
      }],
      matches: [{ externalId: 'm1', groupSlug: 'pool-a', neutralVenue: true, sideA: { sourceType: 'TEAM' } }],
      results: [{ sideAScore: 60, sideBScore: 55 }],
    });
  });
});
