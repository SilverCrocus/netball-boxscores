'use client';

import { useState, type ReactNode } from 'react';

interface MatchTabsProps {
  boxScore: ReactNode;
  playByPlay: ReactNode;
  hasPlayByPlay: boolean;
}

export function MatchTabs({ boxScore, playByPlay, hasPlayByPlay }: MatchTabsProps) {
  const [tab, setTab] = useState<'boxscore' | 'playbyplay'>('boxscore');

  if (!hasPlayByPlay) return <>{boxScore}</>;

  return (
    <>
      <div className="flex gap-6 border-b border-outline-variant/30 mb-8">
        <button
          onClick={() => setTab('boxscore')}
          className={`pb-3 font-label text-sm font-bold uppercase tracking-widest transition-colors cursor-pointer ${
            tab === 'boxscore'
              ? 'text-primary-container border-b-2 border-primary-container'
              : 'text-on-surface-variant hover:text-primary-container/70'
          }`}
        >
          Box Score
        </button>
        <button
          onClick={() => setTab('playbyplay')}
          className={`pb-3 font-label text-sm font-bold uppercase tracking-widest transition-colors cursor-pointer ${
            tab === 'playbyplay'
              ? 'text-primary-container border-b-2 border-primary-container'
              : 'text-on-surface-variant hover:text-primary-container/70'
          }`}
        >
          Play by Play
        </button>
      </div>
      <div key={tab}>
        {tab === 'boxscore' ? boxScore : playByPlay}
      </div>
    </>
  );
}
