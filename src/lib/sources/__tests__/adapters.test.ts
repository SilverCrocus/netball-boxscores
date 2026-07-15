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
      teams: 'externalId,name,slug,abbreviation\nAUS,Australia,australia,AUS\nNZL,New Zealand,new-zealand,NZL',
      players: 'externalId,teamExternalId,name,position\np1,AUS,Test Player,C',
      rosters: 'teamExternalId,playerExternalId,status,bib,isCaptain\nAUS,p1,ACTIVE,C,true',
      matches: 'externalId,stageSlug,scheduledAt,venue,neutralVenue,round,sideATeamExternalId,sideBTeamExternalId\nm1,pool-stage,2026-07-25T08:00:00Z,SEC,true,1,AUS,NZL',
      results: 'matchExternalId,status,sideAScore,sideBScore\nm1,COMPLETED,60,55',
      coverage: 'capability,state\nFINAL_SCORE,AVAILABLE',
    });

    expect(normalized).toMatchObject({
      teams: [{ externalId: 'AUS' }, { externalId: 'NZL' }],
      players: [{ externalId: 'p1', position: 'C' }],
      matches: [{ externalId: 'm1', neutralVenue: true }],
      results: [{ sideAScore: 60, sideBScore: 55 }],
    });
  });
});
