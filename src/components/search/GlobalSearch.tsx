'use client';

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SearchResponse, SearchResult } from '@/types/search';

interface GlobalSearchProps {
  dark?: boolean;
  onNavigate?: () => void;
  askCentrePassEnabled?: boolean;
}

const EMPTY_RESULTS: SearchResponse = { players: [], teams: [], matches: [] };

function Highlight({ label, query }: { label: string; query: string }) {
  const index = label.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0 || !query) return <>{label}</>;
  return (
    <>
      {label.slice(0, index)}
      <mark className="rounded bg-secondary-container/60 px-0.5 text-inherit">{label.slice(index, index + query.length)}</mark>
      {label.slice(index + query.length)}
    </>
  );
}

export function GlobalSearch({ dark = false, onNavigate, askCentrePassEnabled = false }: GlobalSearchProps) {
  const router = useRouter();
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const flattened = useMemo(
    () => [...results.players, ...results.teams, ...results.matches],
    [results],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        const payload = await response.json() as SearchResponse & { error?: { message?: string } };
        if (!response.ok || !payload.players) {
          throw new Error(payload.error?.message || 'Search is temporarily unavailable.');
        }
        setResults(payload);
        setActiveIndex(-1);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught.message : 'Search is temporarily unavailable.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function resetForShortQuery(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults(EMPTY_RESULTS);
      setError('');
      setActiveIndex(-1);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  function navigateTo(result: SearchResult) {
    router.push(result.href);
    setQuery('');
    setResults(EMPTY_RESULTS);
    onNavigate?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (flattened.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % flattened.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? flattened.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      navigateTo(flattened[activeIndex]);
    } else if (event.key === 'Escape') {
      setQuery('');
      setResults(EMPTY_RESULTS);
    }
  }

  const showPanel = query.trim().length >= 2;
  const inputClasses = dark
    ? 'border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus:ring-lime-400'
    : 'border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant focus:ring-secondary';

  return (
    <div className="relative">
      <label htmlFor={`${listboxId}-input`} className="sr-only">Search players, teams, and matches</label>
      <div className="relative">
        <span aria-hidden="true" className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-500">search</span>
        <input
          id={`${listboxId}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          value={query}
          onChange={(event) => resetForShortQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search CentrePass"
          autoComplete="off"
          className={`min-h-11 w-full rounded-xl border py-2 pl-10 pr-3 font-body text-sm outline-none focus:ring-2 ${inputClasses}`}
        />
      </div>
      {askCentrePassEnabled && (
        <Link
          href="/explore"
          onClick={onNavigate}
          className={`mt-2 flex min-h-9 items-center gap-2 rounded-lg px-2 font-label text-xs font-bold ${dark ? 'text-lime-300 hover:bg-slate-800' : 'text-secondary hover:bg-surface-container-low'}`}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-base">query_stats</span>
          Ask CentrePass about statistics
        </Link>
      )}

      {showPanel && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 z-[70] mt-2 max-h-[420px] overflow-y-auto rounded-xl border border-outline-variant/20 bg-white p-2 text-on-surface shadow-2xl"
        >
          {loading && <p role="status" className="px-3 py-4 text-sm text-on-surface-variant">Searching…</p>}
          {error && <p role="alert" className="px-3 py-4 text-sm text-error">{error}</p>}
          {!loading && !error && flattened.length === 0 && (
            <p className="px-3 py-4 text-sm text-on-surface-variant">No matching players, teams, or matches.</p>
          )}
          {(['players', 'teams', 'matches'] as const).map((group) => {
            const groupResults = results[group];
            if (groupResults.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`${listboxId}-${group}`}>
                <h2 id={`${listboxId}-${group}`} className="px-3 pb-1 pt-3 font-label text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {group}
                </h2>
                {groupResults.map((result) => {
                  const index = flattened.findIndex((candidate) => candidate.kind === result.kind && candidate.id === result.id);
                  return (
                    <Link
                      key={`${result.kind}-${result.id}`}
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-selected={activeIndex === index}
                      href={result.href}
                      prefetch={false}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        setQuery('');
                        setResults(EMPTY_RESULTS);
                        onNavigate?.();
                      }}
                      className={`block rounded-lg px-3 py-2 ${activeIndex === index ? 'bg-secondary-container/20' : 'hover:bg-surface-container-low'}`}
                    >
                      <span className="block font-headline text-sm font-bold"><Highlight label={result.label} query={query.trim()} /></span>
                      <span className="block font-label text-[11px] text-on-surface-variant">{result.meta}</span>
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
