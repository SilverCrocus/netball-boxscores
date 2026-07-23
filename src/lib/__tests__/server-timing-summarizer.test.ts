import { describe, expect, it } from 'vitest';
import {
  isServerTimingCoverageGateSatisfied,
  summarizeServerTimingJsonl,
} from '../../../scripts/summarize-server-timing';

describe('server timing summarizer', () => {
  it('reports deterministic p50/p95 values for route, phase, and query groups', () => {
    const lines = [
      ...Array.from({ length: 20 }, (_, index) => JSON.stringify({
        event: 'server_operation_timing',
        route: '/live',
        operation: 'live-page',
        durationMs: index + 1,
        attributedDurationMs: index + 1,
      })),
      ...Array.from({ length: 20 }, (_, index) => JSON.stringify({
        event: 'server_phase_timing',
        route: '/live',
        operation: 'live-page',
        phase: 'live-fallback-candidates',
        durationMs: index + 1,
      })),
      JSON.stringify({
        event: 'server_query_timing',
        route: '/live',
        operation: 'live-page',
        name: 'live_next_match',
        durationMs: 9,
      }),
      JSON.stringify({ event: 'server_cache_timing', name: 'safe', status: 'hit' }),
    ].join('\n');

    const summary = summarizeServerTimingJsonl(lines);

    expect(summary).toMatchObject({
      schemaVersion: 1,
      parsedLineCount: 42,
      validSampleCount: 41,
      invalidLineCount: 0,
      ignoredEventCount: 1,
      coverageSampleCount: 20,
      coverageInvalidCount: 0,
    });
    expect(summary.operations).toEqual([{
      route: '/live',
      operation: 'live-page',
      count: 20,
      p50Ms: 10,
      p95Ms: 19,
      sufficientSamples: true,
    }]);
    expect(summary.phases[0]).toMatchObject({
      route: '/live',
      operation: 'live-page',
      name: 'live-fallback-candidates',
      count: 20,
      p50Ms: 10,
      p95Ms: 19,
      sufficientSamples: true,
    });
    expect(summary.queries[0]).toMatchObject({
      name: 'live_next_match',
      count: 1,
      sufficientSamples: false,
    });
  });

  it('reports insufficient samples and rejects malformed or high-cardinality fields', () => {
    const summary = summarizeServerTimingJsonl([
      JSON.stringify({
        event: 'server_operation_timing',
        route: '/live',
        operation: 'live-page',
        durationMs: 100,
      }),
      JSON.stringify({
        event: 'server_phase_timing',
        route: '/live',
        operation: 'live-page',
        phase: 'unknown-phase',
        durationMs: 20,
      }),
      JSON.stringify({
        event: 'server_query_timing',
        route: '/live?match=secret',
        operation: 'live-page',
        name: 'live_next_match',
        durationMs: 20,
      }),
      '{not-json',
    ].join('\n'));

    expect(summary).toMatchObject({
      parsedLineCount: 4,
      validSampleCount: 1,
      invalidLineCount: 3,
      coverageSampleCount: 0,
      coverageInvalidCount: 1,
      coverageInvalidReasons: ['missing_operation_coverage'],
      invalidReasons: [
        'invalid_json',
        'unknown_phase',
        'unsafe_route_or_operation',
      ],
    });
    expect(summary.operations[0]).toMatchObject({
      count: 1,
      p50Ms: 100,
      p95Ms: 100,
      sufficientSamples: false,
    });
  });

  it('reports named-phase coverage against total operation wall-clock time', () => {
    const summary = summarizeServerTimingJsonl(JSON.stringify({
      event: 'server_operation_timing',
      route: '/live',
      operation: 'live-page',
      durationMs: 100,
      attributedDurationMs: 96,
      phases: {
        'live-active-state': 60,
        'live-fallback-candidates': 36,
      },
    }), { minSamples: 1 });

    expect(summary.phaseCoverage).toEqual([{
      route: '/live',
      operation: 'live-page',
      count: 1,
      p50Pct: 96,
      p95Pct: 96,
      atLeast95Pct: 100,
      sufficientSamples: true,
    }]);
  });

  it('uses overlap-safe operation coverage and rejects legacy or impossible gate samples', () => {
    const overlap = summarizeServerTimingJsonl(JSON.stringify({
      event: 'server_operation_timing',
      route: '/live',
      operation: 'live-page',
      durationMs: 100,
      attributedDurationMs: 100,
      phases: {
        'live-active-state': 80,
        'live-fallback-candidates': 80,
      },
    }), { minSamples: 1 });

    expect(overlap.phaseCoverage[0]).toMatchObject({
      p50Pct: 100,
      p95Pct: 100,
      atLeast95Pct: 100,
    });
    expect(isServerTimingCoverageGateSatisfied(overlap)).toBe(true);

    const legacy = summarizeServerTimingJsonl(JSON.stringify({
      event: 'server_operation_timing',
      route: '/live',
      operation: 'live-page',
      durationMs: 100,
      phases: {
        'live-active-state': 80,
        'live-fallback-candidates': 80,
      },
    }), { minSamples: 1 });
    expect(legacy.coverageInvalidReasons).toEqual(['missing_operation_coverage']);
    expect(isServerTimingCoverageGateSatisfied(legacy)).toBe(false);

    const impossible = summarizeServerTimingJsonl(JSON.stringify({
      event: 'server_operation_timing',
      route: '/live',
      operation: 'live-page',
      durationMs: 100,
      attributedDurationMs: 160,
    }), { minSamples: 1 });
    expect(impossible.coverageInvalidReasons).toEqual(['operation_coverage_exceeds_duration']);
    expect(isServerTimingCoverageGateSatisfied(impossible)).toBe(false);
  });

  it('validates the configured minimum sample size', () => {
    expect(() => summarizeServerTimingJsonl('', { minSamples: 0 })).toThrow(
      'minSamples must be an integer between 1 and 10000',
    );
  });
});
