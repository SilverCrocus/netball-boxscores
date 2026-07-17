import { describe, expect, it } from 'vitest';
import { sourceIdentityKey } from '@/lib/sources/identity';
import { planCompetitionImport } from '@/lib/sources/planner';
import { validImport } from '@/lib/sources/__tests__/fixtures';

const planningContext = {
  sourceSystemId: 'manual-source',
  competitionId: 'edition-id',
  existingIdentities: [],
  knownStageSlugs: ['pool-stage'],
  knownGroupSlugs: ['pool-a', 'pool-b'],
  standingsStrategyKey: 'WORLD_NETBALL_2_1_0',
};

describe('provider-scoped import planning', () => {
  it('cannot collide provider IDs across sources or editions', () => {
    const base = { entityType: 'TEAM' as const, externalId: '123' };
    expect(sourceIdentityKey({ ...base, sourceKey: 'provider-a', editionExternalId: '2026' }))
      .not.toBe(sourceIdentityKey({ ...base, sourceKey: 'provider-b', editionExternalId: '2026' }));
    expect(sourceIdentityKey({ ...base, sourceKey: 'provider-a', editionExternalId: '2026' }))
      .not.toBe(sourceIdentityKey({ ...base, sourceKey: 'provider-a', editionExternalId: '2027' }));
  });

  it('lists exact writes before execution and is deterministic', () => {
    const first = planCompetitionImport(validImport(), planningContext);
    const second = planCompetitionImport(validImport(), planningContext);

    expect(first.valid).toBe(true);
    expect(first.standingsStrategyKey).toBe('WORLD_NETBALL_2_1_0');
    expect(first.checksum).toBe(second.checksum);
    expect(first.writes).toEqual(second.writes);
    expect(first.writes).toContainEqual(expect.objectContaining({
      operation: 'INSERT',
      target: 'MATCH',
      externalId: 'match-1',
    }));
  });

  it('turns replayed scoped identities into updates rather than inserts', () => {
    const preview = planCompetitionImport(validImport(), {
      ...planningContext,
      existingIdentities: [
        { entityType: 'TEAM', externalId: 'AUS', internalEntityId: 'team-aus' },
        { entityType: 'TEAM', externalId: 'NZL', internalEntityId: 'team-nzl' },
        { entityType: 'PLAYER', externalId: 'player-1', internalEntityId: 'player-id' },
        { entityType: 'MATCH', externalId: 'match-1', internalEntityId: 'match-id' },
      ],
    });

    expect(
      preview.writes
        .filter((write) => ['TEAM', 'PLAYER', 'MATCH'].includes(write.target))
        .every((write) => write.operation === 'UPDATE')
    ).toBe(true);
  });

  it('keeps missing provider capabilities explicitly unavailable', () => {
    const preview = planCompetitionImport(validImport(), planningContext);
    expect(preview.coverage).toHaveLength(10);
    expect(preview.coverage.find((item) => item.capability === 'NET_POINTS')).toMatchObject({
      state: 'UNAVAILABLE',
      notes: 'Not supplied by this source payload',
    });
  });

  it('reports unresolved teams, stages, and matches before a transaction', () => {
    const input = validImport();
    input.matches[0].stageSlug = 'missing-stage';
    input.matches[0].sideB = { sourceLabel: 'Pool B winner' };
    input.results[0].matchExternalId = 'missing-match';

    const preview = planCompetitionImport(input, planningContext);
    expect(preview.valid).toBe(false);
    expect(preview.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'STAGE', externalId: 'missing-stage' }),
      expect.objectContaining({ entityType: 'TEAM', externalId: 'Pool B winner' }),
      expect.objectContaining({ entityType: 'MATCH', externalId: 'missing-match' }),
    ]));
  });

  it('validates pool entries and structured knockout match slots', () => {
    const input = validImport();
    input.teams[0].groupSlug = 'pool-a';
    input.teams[1].groupSlug = 'pool-b';
    input.matches.push({
      externalId: 'semi-final-1',
      stageSlug: 'pool-stage',
      scheduledAt: '2026-08-01T09:00:00.000Z',
      venue: 'SEC',
      neutralVenue: true,
      sideA: {
        sourceType: 'GROUP_RANK',
        sourceGroupSlug: 'pool-a',
        sourceRank: 1,
        sourceLabel: 'Pool A 1st',
      },
      sideB: {
        sourceType: 'MATCH_WINNER',
        sourceMatchExternalId: 'match-1',
        sourceLabel: 'Winner of match 1',
      },
    });

    const preview = planCompetitionImport(input, {
      ...planningContext,
      allowUnresolvedMatches: true,
    });

    expect(preview.valid).toBe(true);
    expect(preview.unresolved).toEqual([]);
  });

  it('rejects every duplicate bulk identity before persistence planning', () => {
    const duplicateRoster = validImport();
    duplicateRoster.rosters.push(structuredClone(duplicateRoster.rosters[0]));
    expect(planCompetitionImport(duplicateRoster, planningContext).issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_ROSTER_IDENTITY' }),
    );

    const duplicateResult = validImport();
    duplicateResult.results.push(structuredClone(duplicateResult.results[0]));
    expect(planCompetitionImport(duplicateResult, planningContext).issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_RESULT_IDENTITY' }),
    );

    const duplicatePeriod = validImport();
    duplicatePeriod.results[0].periods = [
      { period: 1, sideAScore: 15, sideBScore: 12 },
      { period: 1, sideAScore: 30, sideBScore: 25 },
    ];
    expect(planCompetitionImport(duplicatePeriod, planningContext).issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_RESULT_PERIOD_IDENTITY' }),
    );

    const duplicateCoverage = validImport();
    duplicateCoverage.coverage.push(structuredClone(duplicateCoverage.coverage[0]));
    expect(planCompetitionImport(duplicateCoverage, planningContext).issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_COVERAGE_IDENTITY' }),
    );
  });
});
