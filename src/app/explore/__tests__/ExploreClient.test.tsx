import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExploreClient } from '@/app/explore/ExploreClient';
import type { StatQueryResponse } from '@/lib/stat-query/types';

const question = 'Who had the most goals in SSN 2026?';

function readyResponse(): StatQueryResponse {
  return {
    status: 'READY', question,
    interpretation: 'leaderboard: player · Goals · total · selected edition',
    spec: {
      version: 'query-spec.v1', intent: 'LEADERBOARD', subject: 'PLAYER', entityIds: [],
      metrics: [{ id: 'goals', aggregation: 'TOTAL' }],
      filters: { editionId: 'edition-1', officialCompletedOnly: true, excludeSimulations: true },
      window: { type: 'EDITION' }, groupBy: 'ENTITY', order: 'DESC', minimumMinutes: 120, limit: 10,
    },
    answer: 'Grace Nweke leads with 220 goals.',
    result: {
      formulaVersion: 'goals.v1', entries: [
        { entity: { id: 'p1', name: 'Grace Nweke', position: 'GS', teamName: 'NSW Swifts' }, result: { value: 220, unit: 'COUNT', coverage: 'AVAILABLE', games: 5, minutes: 300, includedMatchIds: ['m1', 'm2'] } },
        { entity: { id: 'p2', name: 'Sophie Garbin', position: 'GS', teamName: 'Melbourne Vixens' }, result: { value: 205, unit: 'COUNT', coverage: 'PARTIAL', games: 5, minutes: 298, includedMatchIds: ['m3'] } },
      ],
    },
    audit: { parserVersion: 'centrepass-rules.v1', latencyMs: 42, cache: 'MISS', asOf: '2026-07-04T09:30:00.000Z' },
  };
}

function fetchResponse(payload: unknown, ok = true) {
  return { ok, json: async () => payload };
}

describe('ExploreClient', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/explore');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts with an accessible query editor and verified examples', () => {
    render(<ExploreClient />);
    expect(screen.getByRole('textbox', { name: 'Netball statistics question' })).toHaveAttribute('maxlength', '300');
    expect(screen.getByRole('button', { name: 'Run the numbers' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'How Ask CentrePass works' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Grace Nweke|intercepts|Highest goals/ })).toHaveLength(4);
  });

  it('runs with Ctrl+Enter and renders the deterministic answer, chart, table and match audit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse(readyResponse()));
    vi.stubGlobal('fetch', fetchMock);
    render(<ExploreClient />);
    const editor = screen.getByRole('textbox', { name: 'Netball statistics question' });
    fireEvent.change(editor, { target: { value: `  ${question}  ` } });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });

    expect(await screen.findByRole('heading', { name: 'Grace Nweke leads with 220 goals.' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/stats/query', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ question }), signal: expect.any(AbortSignal),
    }));
    expect(screen.getByRole('img', { name: /Goals comparison for 2 results/ })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Sophie Garbin');
    expect(screen.getByRole('link', { name: 'Match 1' })).toHaveAttribute('href', '/match/m1?edition=edition-1');
    expect(window.location.search).toBe(`?q=${encodeURIComponent(question)}`);
  });

  it('offers clarification choices and resubmits the revised question', async () => {
    const clarification: StatQueryResponse = {
      status: 'NEEDS_CLARIFICATION', question: 'What did Grace Nweke average?',
      clarification: { reason: 'METRIC_MISSING', question: 'Which statistic should I use?', options: [{ id: 'goals', label: 'Goals' }] },
      audit: { parserVersion: 'centrepass-rules.v1', latencyMs: 10, cache: 'MISS' },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fetchResponse(clarification))
      .mockResolvedValueOnce(fetchResponse(readyResponse()));
    vi.stubGlobal('fetch', fetchMock);
    render(<ExploreClient />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Netball statistics question' }), { target: { value: clarification.question } });
    fireEvent.click(screen.getByRole('button', { name: 'Run the numbers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Goals' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ body: JSON.stringify({ question: 'What did Grace Nweke average? Goals' }) });
  });

  it('renders unsupported and request-timeout states without inventing a result', async () => {
    const unsupported: StatQueryResponse = {
      status: 'UNSUPPORTED', question,
      error: { code: 'UNSUPPORTED_TEAM_SCOPE', message: 'Scoped team queries are not supported yet.', retryable: false },
      audit: { parserVersion: 'centrepass-rules.v1', latencyMs: 8, cache: 'MISS' },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fetchResponse(unsupported, false))
      .mockResolvedValueOnce(fetchResponse({ error: { code: 'QUERY_TIMEOUT', message: 'The statistical query took too long.', retryable: true } }, false));
    vi.stubGlobal('fetch', fetchMock);
    render(<ExploreClient />);
    const editor = screen.getByRole('textbox', { name: 'Netball statistics question' });
    fireEvent.change(editor, { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Run the numbers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Scoped team queries are not supported yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Run the numbers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The statistical query took too long.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('announces loading and distinguishes an understood query with no covered rows', async () => {
    let resolveRequest: ((value: ReturnType<typeof fetchResponse>) => void) | undefined;
    const pending = new Promise<ReturnType<typeof fetchResponse>>((resolve) => { resolveRequest = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending));
    render(<ExploreClient />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Netball statistics question' }), { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Run the numbers' }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking the covered match sample');

    const empty = readyResponse();
    empty.answer = 'No players meet the selected sample and coverage rules.';
    empty.result = { entries: [] };
    await act(async () => resolveRequest?.(fetchResponse(empty)));
    expect(await screen.findByRole('heading', { name: 'No covered result rows' })).toBeInTheDocument();
  });

  it('runs a safe initial URL query once and copies the shareable address', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse(readyResponse())));
    window.history.replaceState(null, '', `/explore?q=${encodeURIComponent(question)}`);
    render(<ExploreClient initialQuestion={question} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Share this query' }));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Link copied');
  });
});
