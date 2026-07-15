import { describe, expect, it } from 'vitest';
import { findMetricCandidates, metricCatalogue } from '@/lib/analytics/catalogue';

describe('metric catalogue', () => {
  it('has unique, versioned metric IDs and aliases', () => {
    expect(new Set(metricCatalogue.map((metric) => metric.id)).size).toBe(metricCatalogue.length);
    expect(metricCatalogue.every((metric) => metric.formulaVersion.length > 0)).toBe(true);
  });

  it('resolves registered aliases without inventing formulas', () => {
    expect(findMetricCandidates('shooting percentage').map((metric) => metric.id)).toEqual(['goal_accuracy']);
    expect(findMetricCandidates('PRA')).toEqual([]);
  });

  it('keeps official Net Points separately labelled', () => {
    const metric = metricCatalogue.find((candidate) => candidate.id === 'net_points');
    expect(metric?.displayName).toBe('Official Net Points');
    expect(metric?.formulaVersion).toBe('official-net-points.source');
  });

  it('registers advanced composites, team differentials, and Impact as versioned metrics', () => {
    const ids = new Set(metricCatalogue.map((metric) => metric.id));
    expect([
      'shooting_volume',
      'attacking_involvement',
      'defensive_activity',
      'gain_to_turnover_ratio',
      'team_goal_differential',
      'team_turnover_differential',
      'team_shooting_differential',
      'centrepass_impact',
    ].every((id) => ids.has(id))).toBe(true);
    expect(metricCatalogue.find((metric) => metric.id === 'centrepass_impact'))
      .toMatchObject({ formulaVersion: 'centrepass-impact.v1', calculation: { kind: 'SERVICE' } });
  });
});
