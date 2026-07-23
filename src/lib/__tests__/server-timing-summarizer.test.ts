import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_TIMING_INPUT_BYTES,
  MAX_TIMING_LINE_BYTES,
  MAX_TIMING_SAMPLES_PER_GROUP,
  isServerTimingCoverageGateSatisfied,
  scanTimingJsonl,
  SummarizerLimitError,
  summarizeServerTimingReadable,
  summarizeServerTimingJsonl,
  type TimingInputSource,
} from '../../../scripts/summarize-server-timing';

function trackedSource(chunks: readonly (Buffer | string)[]) {
  const state = { consumed: 0, destroyed: false, returned: false };
  let index = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (index >= chunks.length) return { done: true, value: undefined as never };
          state.consumed += 1;
          return { done: false, value: chunks[index++] };
        },
        return: async () => {
          state.returned = true;
          return { done: true, value: undefined as never };
        },
      };
    },
    destroy: () => {
      state.destroyed = true;
    },
  } as TimingInputSource;
  return { source, state };
}

describe('server timing summarizer', () => {
  it('reports deterministic p50/p95 values for route, phase, and query groups', () => {
    const lines = [
      ...Array.from({ length: 20 }, (_, index) => JSON.stringify({
        event: 'server_operation_timing',
        route: '/live',
        operation: 'live-page',
        durationMs: index + 1,
        attributedDurationMs: index + 1,
        outcome: 'success',
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
        outcome: 'success',
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
      outcome: 'success',
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
      outcome: 'success',
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
      outcome: 'success',
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
      outcome: 'success',
    }), { minSamples: 1 });
    expect(impossible.coverageInvalidReasons).toEqual(['operation_coverage_exceeds_duration']);
    expect(isServerTimingCoverageGateSatisfied(impossible)).toBe(false);
  });

  it('validates the configured minimum sample size', () => {
    expect(() => summarizeServerTimingJsonl('', { minSamples: 0 })).toThrow(
      'minSamples must be an integer between 1 and 10000',
    );
  });

  it('rejects nonpositive operation durations from the coverage denominator', () => {
    const summary = summarizeServerTimingJsonl(
      Array.from({ length: 20 }, () => JSON.stringify({
        event: 'server_operation_timing',
        route: '/live',
        operation: 'live-page',
        durationMs: 0,
        attributedDurationMs: 0,
        outcome: 'success',
      })).join('\n'),
    );

    expect(summary).toMatchObject({
      successSampleCount: 20,
      coverageSampleCount: 0,
      coverageInvalidCount: 20,
      coverageInvalidReasons: ['nonpositive_operation_duration'],
    });
    expect(isServerTimingCoverageGateSatisfied(summary)).toBe(false);
  });

  it('counts failed renders separately and uses only explicit successes for acceptance', () => {
    const errors = Array.from({ length: 20 }, () => JSON.stringify({
      event: 'server_operation_timing',
      route: '/live',
      operation: 'live-page',
      durationMs: 100,
      attributedDurationMs: 100,
      outcome: 'error',
    }));
    const errorSummary = summarizeServerTimingJsonl(errors.join('\n'));
    expect(errorSummary).toMatchObject({
      successSampleCount: 0,
      errorSampleCount: 20,
      coverageSampleCount: 0,
    });
    expect(isServerTimingCoverageGateSatisfied(errorSummary)).toBe(false);

    const mixedSummary = summarizeServerTimingJsonl([
      ...errors.slice(0, 2),
      ...Array.from({ length: 20 }, () => JSON.stringify({
        event: 'server_operation_timing',
        route: '/live',
        operation: 'live-page',
        durationMs: 100,
        attributedDurationMs: 100,
        outcome: 'success',
      })),
    ].join('\n'));
    expect(mixedSummary).toMatchObject({
      successSampleCount: 20,
      errorSampleCount: 2,
      coverageSampleCount: 20,
    });
    expect(isServerTimingCoverageGateSatisfied(mixedSummary)).toBe(true);

    const legacy = summarizeServerTimingJsonl(JSON.stringify({
      event: 'server_operation_timing',
      route: '/live',
      operation: 'live-page',
      durationMs: 100,
      attributedDurationMs: 100,
    }), { minSamples: 1 });
    expect(legacy.outcomeInvalidReasons).toEqual(['missing_operation_outcome']);
    expect(isServerTimingCoverageGateSatisfied(legacy)).toBe(false);
  });

  it('bounds direct input and retained quantile samples without echoing log content', () => {
    expect(() => summarizeServerTimingJsonl('x'.repeat(MAX_TIMING_INPUT_BYTES + 1))).toThrowError(
      SummarizerLimitError,
    );
    expect(() => summarizeServerTimingJsonl('x'.repeat(MAX_TIMING_LINE_BYTES + 1))).toThrowError(
      SummarizerLimitError,
    );
    expect(() => summarizeServerTimingJsonl(
      Array.from({ length: MAX_TIMING_SAMPLES_PER_GROUP + 1 }, () => JSON.stringify({
        event: 'server_query_timing',
        route: '/live',
        operation: 'live-page',
        name: 'live_next_match',
        durationMs: 1,
      })).join('\n'),
    )).toThrowError(SummarizerLimitError);
  });

  it('scans bounded chunks before retaining an oversized unterminated line', async () => {
    const sentinel = Buffer.from('SENTINEL_SHOULD_NOT_BE_CONSUMED');
    const { source, state } = trackedSource([
      Buffer.alloc(700 * 1024, 0x78),
      Buffer.alloc(700 * 1024, 0x79),
      sentinel,
    ]);

    await expect(scanTimingJsonl(source, () => {})).rejects.toMatchObject({
      name: 'SummarizerLimitError',
      code: 'oversized_line',
    });
    expect(state.consumed).toBe(2);
    expect(state.destroyed).toBe(true);
    expect(state.returned).toBe(true);
  });

  it('rejects maximum content plus a bare carriage return at EOF before callback', async () => {
    const { source } = trackedSource([
      Buffer.concat([Buffer.alloc(MAX_TIMING_LINE_BYTES, 0x78), Buffer.from('\r')]),
    ]);
    const lines: string[] = [];

    await expect(scanTimingJsonl(source, (line) => {
      lines.push(line);
    })).rejects.toMatchObject({
      name: 'SummarizerLimitError',
      code: 'oversized_line',
    });
    expect(lines).toEqual([]);
  });

  it('accepts maximum content followed by CRLF as one maximum-length line', async () => {
    const { source } = trackedSource([
      Buffer.concat([Buffer.alloc(MAX_TIMING_LINE_BYTES, 0x78), Buffer.from('\r\n')]),
    ]);
    const lines: string[] = [];

    await scanTimingJsonl(source, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(['x'.repeat(MAX_TIMING_LINE_BYTES)]);
  });

  it('counts a non-delimiter carriage return as content at the line boundary', async () => {
    const sentinel = Buffer.from('SENTINEL_SHOULD_NOT_BE_CONSUMED');
    const { source, state } = trackedSource([
      Buffer.alloc(MAX_TIMING_LINE_BYTES - 1, 0x78),
      Buffer.from('\r'),
      Buffer.from('z'),
      sentinel,
    ]);

    await expect(scanTimingJsonl(source, () => {})).rejects.toMatchObject({
      name: 'SummarizerLimitError',
      code: 'oversized_line',
    });
    expect(state.consumed).toBe(3);
    expect(state.destroyed).toBe(true);
    expect(state.returned).toBe(true);
  });

  it('accepts CR and LF split across source chunks at the maximum boundary', async () => {
    const { source } = trackedSource([
      Buffer.alloc(MAX_TIMING_LINE_BYTES, 0x78),
      Buffer.from('\r'),
      Buffer.from('\n'),
    ]);
    const lines: string[] = [];

    await scanTimingJsonl(source, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual(['x'.repeat(MAX_TIMING_LINE_BYTES)]);
  });

  it('handles split CRLF, split UTF-8, empty lines, and a final unterminated line', async () => {
    const prefix = Buffer.from('{"event":"server_cache_timing","message":"');
    const emoji = Buffer.from('😀');
    const suffix = Buffer.from('"}\r\n{"event":"server_cache_timing"}');
    const input = Buffer.concat([prefix, emoji, suffix]);
    const splitAt = prefix.length + 1;
    const { source } = trackedSource([
      Buffer.concat([Buffer.from('\n\r\n'), input.subarray(0, splitAt)]),
      input.subarray(splitAt),
    ]);
    const lines: string[] = [];

    await scanTimingJsonl(source, (line) => {
      lines.push(line);
    });

    expect(lines).toEqual([
      '',
      '',
      '{"event":"server_cache_timing","message":"😀"}',
      '{"event":"server_cache_timing"}',
    ]);

    const finalLine = JSON.stringify({
      event: 'server_query_timing',
      route: '/live',
      operation: 'live-page',
      name: 'live_next_match',
      durationMs: 1,
    });
    const summary = await summarizeServerTimingReadable(
      trackedSource([Buffer.from(finalLine)]).source,
      { minSamples: 1 },
    );
    expect(summary.queries).toMatchObject([{
      name: 'live_next_match',
      count: 1,
    }]);
  });

  it('stops and preserves the original source error without echoing input', async () => {
    const sourceError = new Error('upstream stream failed');
    const state = { destroyed: false, returned: false };
    const source = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw sourceError;
          },
          return: async () => {
            state.returned = true;
            return { done: true, value: undefined as never };
          },
        };
      },
      destroy: () => {
        state.destroyed = true;
      },
    } as TimingInputSource;

    await expect(scanTimingJsonl(source, () => {})).rejects.toBe(sourceError);
    expect(state.destroyed).toBe(true);
    expect(state.returned).toBe(true);
  });

  it('rejects the total byte cap before requesting another source chunk', async () => {
    const first = Buffer.alloc(MAX_TIMING_INPUT_BYTES, 0x78);
    for (let offset = MAX_TIMING_LINE_BYTES - 1; offset < first.length; offset += MAX_TIMING_LINE_BYTES) {
      first[offset] = 0x0a;
    }
    const { source, state } = trackedSource([
      first,
      Buffer.from('x'),
      Buffer.from('SENTINEL_SHOULD_NOT_BE_CONSUMED'),
    ]);

    await expect(scanTimingJsonl(source, () => {})).rejects.toMatchObject({
      name: 'SummarizerLimitError',
      code: 'input_byte_limit',
    });
    expect(state.consumed).toBe(2);
    expect(state.destroyed).toBe(true);
    expect(state.returned).toBe(true);
  });

  it('exercises the CLI gate and bounded-input failure paths', () => {
    const cli = path.resolve('scripts/summarize-server-timing.ts');
    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
    const run = (input: string, args: string[] = []) => spawnSync(
      process.execPath,
      [tsx, cli, ...args],
      { cwd: process.cwd(), input, encoding: 'utf8' },
    );
    const nonpositiveInput = Array.from({ length: 20 }, () => JSON.stringify({
      event: 'server_operation_timing',
      route: '/live',
      operation: 'live-page',
      durationMs: 0,
      attributedDurationMs: 0,
      outcome: 'success',
    })).join('\n');
    const nonpositive = run(nonpositiveInput, ['--require-coverage']);
    expect(nonpositive.status).toBe(2);
    expect(nonpositive.stdout).toContain('nonpositive_operation_duration');
    expect(nonpositive.stdout).toContain('"coverageInvalidCount": 20');

    const sensitiveMarker = 'SENSITIVE_MARKER_DO_NOT_ECHO';
    const oversizedInput = `${'x'.repeat(MAX_TIMING_LINE_BYTES - sensitiveMarker.length)}${sensitiveMarker}x`;
    const oversized = run(oversizedInput);
    expect(oversized.status).toBe(2);
    expect(oversized.stdout).toContain('"code":"oversized_line"');
    expect(oversized.stdout).not.toContain(sensitiveMarker);
    expect(oversized.stderr).not.toContain(sensitiveMarker);

    const sampleOverflow = run(Array.from({ length: MAX_TIMING_SAMPLES_PER_GROUP + 1 }, () => JSON.stringify({
      event: 'server_query_timing',
      route: '/live',
      operation: 'live-page',
      name: 'live_next_match',
      durationMs: 1,
    })).join('\n'));
    expect(sampleOverflow.status).toBe(2);
    expect(sampleOverflow.stdout).toContain('"code":"sample_cap_exceeded"');
  });
});
