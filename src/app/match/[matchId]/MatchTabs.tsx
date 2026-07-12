'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

interface MatchTabsProps {
  boxScore: ReactNode;
  playByPlay: ReactNode;
  hasPlayByPlay: boolean;
}

export function MatchTabs({ boxScore, playByPlay, hasPlayByPlay }: MatchTabsProps) {
  const [tab, setTab] = useState<'boxscore' | 'playbyplay'>('boxscore');
  const boxScoreRef = useRef<HTMLButtonElement>(null);
  const playByPlayRef = useRef<HTMLButtonElement>(null);

  if (!hasPlayByPlay) return <>{boxScore}</>;

  function selectTab(nextTab: 'boxscore' | 'playbyplay') {
    setTab(nextTab);
    const nextRef = nextTab === 'boxscore' ? boxScoreRef : playByPlayRef;
    nextRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectTab(tab === 'boxscore' ? 'playbyplay' : 'boxscore');
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectTab('boxscore');
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab('playbyplay');
    }
  }

  return (
    <>
      <div role="tablist" aria-label="Match details" className="flex gap-6 border-b border-outline-variant/30 mb-8">
        <button
          ref={boxScoreRef}
          id="match-tab-boxscore"
          role="tab"
          type="button"
          aria-selected={tab === 'boxscore'}
          aria-controls="match-panel-boxscore"
          tabIndex={tab === 'boxscore' ? 0 : -1}
          onClick={() => setTab('boxscore')}
          onKeyDown={handleKeyDown}
          className={`cursor-pointer pb-3 font-label text-sm font-bold uppercase tracking-widest transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary ${
            tab === 'boxscore'
              ? 'text-primary-container border-b-2 border-primary-container'
              : 'text-on-surface-variant hover:text-primary-container/70'
          }`}
        >
          Box Score
        </button>
        <button
          ref={playByPlayRef}
          id="match-tab-playbyplay"
          role="tab"
          type="button"
          aria-selected={tab === 'playbyplay'}
          aria-controls="match-panel-playbyplay"
          tabIndex={tab === 'playbyplay' ? 0 : -1}
          onClick={() => setTab('playbyplay')}
          onKeyDown={handleKeyDown}
          className={`cursor-pointer pb-3 font-label text-sm font-bold uppercase tracking-widest transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-secondary ${
            tab === 'playbyplay'
              ? 'text-primary-container border-b-2 border-primary-container'
              : 'text-on-surface-variant hover:text-primary-container/70'
          }`}
        >
          Play by Play
        </button>
      </div>
      <div
        key={tab}
        id={tab === 'boxscore' ? 'match-panel-boxscore' : 'match-panel-playbyplay'}
        role="tabpanel"
        aria-labelledby={tab === 'boxscore' ? 'match-tab-boxscore' : 'match-tab-playbyplay'}
        tabIndex={0}
      >
        {tab === 'boxscore' ? boxScore : playByPlay}
      </div>
    </>
  );
}
