'use client';

import Link from 'next/link';
import { matchHref } from '@/lib/edition-links';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { buildExploreResultModel, type ExploreResultModel } from '@/app/explore/result-model';
import type { StatQueryResponse } from '@/lib/stat-query/types';

const EXAMPLES = [
  'What did Grace Nweke average for goals in her last 5 games?',
  'Who had the most intercepts per 60 in SSN 2026 top 5 minimum 120 minutes?',
  'Compare Grace Nweke versus Shamera Sterling-Humphrey for goals per 60 in SSN 2026 last 5 games',
  'Highest goals in a match in SSN 2026 top 10',
] as const;

interface ExploreClientProps {
  initialQuestion?: string;
}

interface ApiErrorPayload {
  error?: { code?: string; message?: string; retryable?: boolean };
}

function normalizedQuestion(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function dateLabel(value?: string | null): string {
  if (!value) return 'No eligible result time';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function ExploreClient({ initialQuestion = '' }: ExploreClientProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const [response, setResponse] = useState<StatQueryResponse | null>(null);
  const [requestError, setRequestError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [shareState, setShareState] = useState('');
  const [, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);
  const initialRunRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const runQuestion = useCallback(async (value: string, updateUrl = true) => {
    const submitted = normalizedQuestion(value);
    if (submitted.length < 2) {
      setRequestError({ message: 'Enter a netball statistics question using at least two characters.', retryable: false });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setQuestion(submitted);
    setRequesting(true);
    setRequestError(null);
    setShareState('');
    if (updateUrl) window.history.replaceState(null, '', `/explore?q=${encodeURIComponent(submitted)}`);
    try {
      const apiResponse = await fetch('/api/stats/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: submitted }),
        signal: controller.signal,
      });
      const payload = await apiResponse.json() as StatQueryResponse & ApiErrorPayload;
      if (!apiResponse.ok && !payload.status) {
        throw new Error(payload.error?.message || 'Statistical search is temporarily unavailable.');
      }
      startTransition(() => setResponse(payload));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setResponse(null);
      setRequestError({
        message: error instanceof Error ? error.message : 'Statistical search is temporarily unavailable.',
        retryable: true,
      });
    } finally {
      if (!controller.signal.aborted) setRequesting(false);
    }
  }, []);

  useEffect(() => {
    if (!initialQuestion || initialRunRef.current) return;
    initialRunRef.current = true;
    void runQuestion(initialQuestion, false);
  }, [initialQuestion, runQuestion]);

  useEffect(() => {
    if (response || requestError) resultRef.current?.focus();
  }, [requestError, response]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuestion(question);
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function chooseExample(example: string) {
    setQuestion(example);
    void runQuestion(example);
  }

  async function shareResult() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareState('Link copied');
    } catch {
      setShareState('Copy the page address to share this result');
    }
  }

  const clarificationOptions = response?.status === 'NEEDS_CLARIFICATION'
    ? response.clarification?.options.filter((option) => !question.toLocaleLowerCase().includes(option.label.toLocaleLowerCase())) ?? []
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-8">
      <header className="relative isolate overflow-hidden rounded-[2rem] bg-primary-container px-5 py-8 text-white shadow-2xl sm:px-9 sm:py-11 lg:px-12">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-5 right-[-8rem] hidden w-[34rem] rotate-[-7deg] rounded-[3rem] border border-lime-300/15 lg:block">
          <span className="absolute inset-y-0 left-1/2 border-l border-lime-300/15" />
          <span className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-lime-300/15" />
          <span className="absolute inset-x-0 top-1/3 border-t border-lime-300/15" />
          <span className="absolute inset-x-0 top-2/3 border-t border-lime-300/15" />
        </div>
        <div className="relative max-w-4xl">
          <p className="font-label text-xs font-black uppercase tracking-[0.24em] text-lime-300">Ask CentrePass · Rules engine v1</p>
          <h1 className="mt-3 font-headline text-4xl font-black tracking-tight sm:text-6xl lg:text-7xl">A stats desk that shows its work.</h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            Ask a netball question in everyday language. CentrePass resolves it to a fixed metric and audited match sample—never arbitrary AI-generated SQL.
          </p>
        </div>
      </header>

      <section className="relative overflow-hidden rounded-3xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xl sm:p-6 lg:p-8" aria-labelledby="query-heading">
        <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-secondary via-lime-300 to-primary-container" />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-label text-[11px] font-black uppercase tracking-[0.2em] text-secondary">Query console</p>
            <h2 id="query-heading" className="mt-1 font-headline text-2xl font-black text-primary">What do you want to know?</h2>
          </div>
          <p className="font-label text-xs text-on-surface-variant">⌘/Ctrl + Enter to run · 300 characters max</p>
        </div>

        <form ref={formRef} onSubmit={submit} className="mt-5">
          <label htmlFor="centrepass-question" className="sr-only">Netball statistics question</label>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-stretch">
            <textarea
              id="centrepass-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value.slice(0, 300))}
              onKeyDown={handleQuestionKeyDown}
              maxLength={300}
              rows={3}
              autoComplete="off"
              placeholder="e.g. Who had the most intercepts per 60 in SSN 2026?"
              aria-describedby="query-help"
              className="min-h-32 w-full resize-y rounded-2xl border border-outline-variant bg-surface-container-low px-5 py-4 font-headline text-base font-semibold leading-7 text-primary outline-none transition focus:border-secondary focus:bg-white focus:ring-4 focus:ring-secondary/15 sm:text-lg"
            />
            <button
              type="submit"
              disabled={requesting}
              className="min-h-14 rounded-2xl bg-secondary px-7 font-headline text-base font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-on-secondary-fixed-variant focus:outline-none focus:ring-4 focus:ring-secondary/30 disabled:cursor-wait disabled:opacity-60 lg:min-w-48"
            >
              {requesting ? 'Running query…' : 'Run the numbers'}
            </button>
          </div>
          <div id="query-help" className="mt-2 flex items-center justify-between gap-3 font-label text-xs text-on-surface-variant">
            <span>Players, teams, editions, windows, stages, comparisons and records</span>
            <span>{question.length}/300</span>
          </div>
        </form>

        <div className="mt-6 border-t border-outline-variant pt-5">
          <p className="font-label text-[11px] font-black uppercase tracking-[0.16em] text-on-surface-variant">Try a verified pattern</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example, index) => (
              <button
                key={example}
                type="button"
                onClick={() => chooseExample(example)}
                disabled={requesting}
                className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-2 text-left font-label text-xs font-bold text-primary transition hover:border-secondary hover:bg-secondary-container/20 focus:outline-none focus:ring-2 focus:ring-secondary"
              >
                <span className="mr-1.5 text-secondary">0{index + 1}</span>{example}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div ref={resultRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {requesting ? <LoadingState /> : null}
        {!requesting && requestError ? (
          <RequestErrorState error={requestError} onRetry={() => void runQuestion(question)} />
        ) : null}
        {!requesting && response?.status === 'UNSUPPORTED' ? (
          <UnsupportedState response={response} />
        ) : null}
        {!requesting && response?.status === 'NEEDS_CLARIFICATION' ? (
          <ClarificationState
            response={response}
            options={clarificationOptions}
            onSelect={(label) => {
              const revised = normalizedQuestion(`${question} ${label}`);
              setQuestion(revised);
              void runQuestion(revised);
            }}
          />
        ) : null}
        {!requesting && response?.status === 'READY' ? (
          <ReadyResult response={response} shareState={shareState} onShare={() => void shareResult()} />
        ) : null}
        {!requesting && !requestError && !response ? <WelcomeState /> : null}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <section role="status" className="grid gap-4 rounded-3xl bg-primary-container p-6 text-white shadow-xl sm:grid-cols-[auto_1fr] sm:items-center sm:p-8">
      <span aria-hidden="true" className="material-symbols-outlined animate-spin text-4xl text-lime-300">progress_activity</span>
      <div><h2 className="font-headline text-xl font-black">Checking the covered match sample</h2><p className="mt-1 text-sm text-slate-300">Resolving entities, metric, window and data availability…</p></div>
    </section>
  );
}

function RequestErrorState({ error, onRetry }: { error: { message: string; retryable: boolean }; onRetry: () => void }) {
  return (
    <section role="alert" className="rounded-3xl border border-error/30 bg-error-container p-6 text-on-error-container shadow-sm sm:p-8">
      <p className="font-label text-xs font-black uppercase tracking-[0.18em]">Query unavailable</p>
      <h2 className="mt-2 font-headline text-2xl font-black">We couldn’t run that query.</h2>
      <p className="mt-2 max-w-2xl text-sm">{error.message}</p>
      {error.retryable ? <button type="button" onClick={onRetry} className="mt-5 rounded-xl bg-error px-5 py-3 font-headline text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-error/30">Try again</button> : null}
    </section>
  );
}

function UnsupportedState({ response }: { response: StatQueryResponse }) {
  return (
    <section role="alert" className="rounded-3xl border border-amber-400/50 bg-amber-50 p-6 text-amber-950 shadow-sm sm:p-8">
      <p className="font-label text-xs font-black uppercase tracking-[0.18em] text-amber-700">Outside the current grammar</p>
      <h2 className="mt-2 font-headline text-2xl font-black">CentrePass can’t answer that safely yet.</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6">{response.error?.message ?? 'Try a player, metric, competition and time window.'}</p>
      <p className="mt-4 font-mono text-xs text-amber-800">{response.error?.code ?? 'UNSUPPORTED'}</p>
    </section>
  );
}

function ClarificationState({ response, options, onSelect }: { response: StatQueryResponse; options: Array<{ id: string; label: string }>; onSelect: (label: string) => void }) {
  return (
    <section className="rounded-3xl border border-secondary/30 bg-secondary-container/15 p-6 shadow-sm sm:p-8">
      <p className="font-label text-xs font-black uppercase tracking-[0.18em] text-secondary">One detail needed</p>
      <h2 className="mt-2 font-headline text-2xl font-black text-primary">{response.clarification?.question ?? 'Can you make the question more specific?'}</h2>
      {options.length > 0 ? (
        <fieldset className="mt-5"><legend className="sr-only">Clarification choices</legend><div className="flex flex-wrap gap-2">{options.map((option) => <button key={option.id} type="button" onClick={() => onSelect(option.label)} className="rounded-xl bg-secondary px-4 py-3 font-headline text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-secondary/30">Use {option.label}</button>)}</div></fieldset>
      ) : <p className="mt-4 text-sm text-on-surface-variant">Edit the question above to add the missing player, team, metric or edition, then run it again.</p>}
    </section>
  );
}

function WelcomeState() {
  return (
    <section className="grid gap-4 sm:grid-cols-3" aria-label="How Ask CentrePass works">
      <WelcomeCard number="01" title="Resolve" body="Names, aliases and common typos map to canonical CentrePass entities and metrics." />
      <WelcomeCard number="02" title="Calculate" body="Only registered formulas run over official, completed, non-simulation matches." />
      <WelcomeCard number="03" title="Audit" body="Every answer keeps its sample, coverage, formula and included matches visible." />
    </section>
  );
}

function WelcomeCard({ number, title, body }: { number: string; title: string; body: string }) {
  return <article className="rounded-2xl bg-surface-container-low p-5"><p className="font-label text-xs font-black text-secondary">{number}</p><h2 className="mt-2 font-headline text-xl font-black text-primary">{title}</h2><p className="mt-2 text-sm leading-6 text-on-surface-variant">{body}</p></article>;
}

function ReadyResult({ response, shareState, onShare }: { response: StatQueryResponse; shareState: string; onShare: () => void }) {
  const model = buildExploreResultModel(response);
  return (
    <section className="space-y-5" aria-labelledby="answer-heading">
      <article className="overflow-hidden rounded-3xl bg-primary-container text-white shadow-2xl">
        <div className="grid gap-7 px-6 py-8 sm:px-9 lg:grid-cols-[1fr_auto] lg:items-end lg:px-11 lg:py-10">
          <div>
            <p className="font-label text-xs font-black uppercase tracking-[0.2em] text-lime-300">CentrePass answer</p>
            <h2 id="answer-heading" className="mt-3 max-w-4xl font-headline text-3xl font-black leading-tight sm:text-5xl">{response.answer}</h2>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">Interpreted as: {response.interpretation}</p>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <button type="button" onClick={onShare} className="rounded-xl border border-lime-300/40 bg-lime-300/10 px-4 py-3 font-headline text-sm font-bold text-lime-200 focus:outline-none focus:ring-4 focus:ring-lime-300/20">Share this query</button>
            <p role="status" className="min-h-4 font-label text-[11px] text-slate-300">{shareState}</p>
          </div>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-2 lg:grid-cols-4">
          <AuditDatum label="As of" value={dateLabel(response.audit.asOf)} />
          <AuditDatum label="Formula" value={model?.formulaVersion ?? 'Registered formula'} />
          <AuditDatum label="Coverage" value={model?.coverageLabel ?? 'Unavailable'} />
          <AuditDatum label="Parser" value={`${response.audit.parserVersion} · ${response.audit.latencyMs}ms`} />
        </div>
      </article>

      {!model || model.rows.length === 0 ? (
        <section className="rounded-2xl border border-outline-variant bg-surface-container-lowest px-6 py-12 text-center shadow-sm">
          <h3 className="font-headline text-2xl font-black text-primary">No covered result rows</h3>
          <p className="mt-2 text-sm text-on-surface-variant">The query was understood, but no official covered matches met its sample rules.</p>
        </section>
      ) : (
        <>
          {model.chartable ? <ResultChart model={model} /> : null}
          <ResultTable model={model} />
          <EvidencePanel model={model} response={response} />
        </>
      )}
    </section>
  );
}

function AuditDatum({ label, value }: { label: string; value: string }) {
  return <div className="border-white/10 px-6 py-4 sm:border-l first:border-l-0"><p className="font-label text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p><p className="mt-1 truncate font-headline text-sm font-bold text-white" title={value}>{value}</p></div>;
}

function ResultChart({ model }: { model: ExploreResultModel }) {
  const maximum = Math.max(...model.rows.map((row) => Math.abs(row.value ?? 0)), 1);
  return (
    <section className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm sm:p-7" aria-labelledby="chart-heading">
      <div className="flex items-baseline justify-between gap-4"><h3 id="chart-heading" className="font-headline text-xl font-black text-primary">Visual comparison</h3><p className="font-label text-xs text-on-surface-variant">{model.metricName} · {model.aggregation}</p></div>
      <div className="mt-6 space-y-4" role="img" aria-label={`${model.metricName} comparison for ${model.rows.length} results`}>
        {model.rows.slice(0, 10).map((row) => (
          <div key={row.id} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3">
            <p className="truncate font-headline text-xs font-bold text-primary sm:text-sm">{row.label}</p>
            <div className="h-3 overflow-hidden rounded-full bg-surface-container-high"><div className="h-full rounded-full bg-gradient-to-r from-secondary to-lime-400" style={{ width: `${Math.max(2, (Math.abs(row.value ?? 0) / maximum) * 100)}%` }} /></div>
            <p className="min-w-14 text-right font-headline text-sm font-black text-primary">{row.valueLabel}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResultTable({ model }: { model: ExploreResultModel }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl" aria-labelledby="result-table-heading">
      <div className="flex flex-col gap-1 bg-surface-container-low px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><h3 id="result-table-heading" className="font-headline text-xl font-black text-primary">Result detail</h3><p className="font-label text-xs text-on-surface-variant">{model.rows.length} {model.rows.length === 1 ? 'result' : 'results'}</p></div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sr-only"><tr><th>Result</th><th>Value</th><th>Sample</th><th>Coverage</th></tr></thead>
          <tbody className="divide-y divide-surface-container">
            {model.rows.map((row, index) => (
              <tr key={`${row.id}-${index}`}>
                <td className="px-4 py-5 sm:px-6"><p className="font-label text-[10px] font-black text-secondary">{String(index + 1).padStart(2, '0')}</p>{row.href ? <Link href={row.href} className="font-headline text-base font-black text-primary hover:text-secondary sm:text-lg">{row.label}</Link> : <p className="font-headline text-base font-black text-primary sm:text-lg">{row.label}</p>}<p className="mt-1 max-w-xl text-xs text-on-surface-variant">{row.meta}</p></td>
                <td className="whitespace-nowrap px-3 py-5 text-right font-headline text-xl font-black text-secondary sm:text-2xl">{row.valueLabel}</td>
                <td className="hidden whitespace-nowrap px-3 py-5 text-right text-xs text-on-surface-variant sm:table-cell">{row.games ?? 0} games<br />{row.minutes === null ? 'Minutes unavailable' : `${row.minutes.toFixed(0)} minutes`}</td>
                <td className="hidden px-6 py-5 text-right font-label text-[11px] font-black uppercase tracking-wider text-on-surface-variant md:table-cell">{row.coverage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvidencePanel({ model, response }: { model: ExploreResultModel; response: StatQueryResponse }) {
  return (
    <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <article className="rounded-2xl border border-outline-variant bg-surface-container-low p-5 sm:p-6"><p className="font-label text-[11px] font-black uppercase tracking-[0.16em] text-secondary">Definition and source</p><h3 className="mt-2 font-headline text-xl font-black text-primary">{model.metricName}</h3><p className="mt-2 text-sm leading-6 text-on-surface-variant">{model.definition}</p><p className="mt-4 font-mono text-xs text-on-surface-variant">{model.formulaVersion} · {model.aggregation}</p><p className="mt-3 text-xs leading-5 text-on-surface-variant">Source policy: official completed results with declared coverage; simulation data is excluded. Missing data is unavailable, never converted to zero.</p></article>
      <article className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 sm:p-6"><p className="font-label text-[11px] font-black uppercase tracking-[0.16em] text-secondary">Included matches</p><h3 className="mt-2 font-headline text-xl font-black text-primary">Audit the sample</h3>{model.includedMatchIds.length > 0 && response.spec ? <div className="mt-4 flex flex-wrap gap-2">{model.includedMatchIds.map((matchId, index) => <Link key={matchId} href={matchHref(matchId, response.spec!.filters.editionId)} className="rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-label text-xs font-bold text-primary hover:border-secondary">Match {index + 1}</Link>)}</div> : <p className="mt-3 text-sm text-on-surface-variant">No match-level identifiers were returned for this aggregate.</p>}<details className="mt-5 border-t border-outline-variant pt-4 text-xs text-on-surface-variant"><summary className="cursor-pointer font-bold text-primary">Normalized query</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-primary-container p-3 text-[10px] text-slate-200">{JSON.stringify(response.spec, null, 2)}</pre></details></article>
    </section>
  );
}
