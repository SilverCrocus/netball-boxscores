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
});
