'use client';

import { useRef, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';

export interface FeedEntry {
  time: string;
  quarter: number;
  eventType: 'goal' | 'intercept';
  scorerName?: string;
  scorerPlayerId?: string;
  playerName?: string;
  playerId?: string;
  teamAbbreviation: string;
  teamName: string;
  teamLogoUrl?: string | null;
  isHomeTeam: boolean;
  homeScore?: number;
  awayScore?: number;
  scorePoints?: number;
}

interface LivePlayByPlayProps {
  entries: FeedEntry[];
}

export function LivePlayByPlay({ entries }: LivePlayByPlayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to top (newest) when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  const reversed = [...entries].reverse();

  return (
    <div className="bg-slate-950 rounded-xl overflow-hidden shadow-2xl sticky top-24">
      {/* Header */}
      <div className="bg-slate-800 p-4 border-b border-slate-800 flex items-center justify-between">
        <h4 className="text-white font-headline text-sm font-bold uppercase tracking-widest flex items-center gap-2">
          <span className="material-symbols-outlined text-lime-400 text-sm">
            sensors
          </span>
          Live Feed
        </h4>
        <span className="text-[10px] text-lime-400 font-bold uppercase">
          Real-Time
        </span>
      </div>

      {/* Feed entries */}
      <div ref={scrollRef} className="h-[600px] overflow-y-auto">
        {reversed.length === 0 && (
          <p className="text-slate-500 text-sm text-center mt-8">
            Waiting for live events...
          </p>
        )}
        {reversed.map((entry, i) => {
          const showSeparator =
            i > 0 && reversed[i - 1].quarter !== entry.quarter;

          return (
            <Fragment key={i}>
              {showSeparator && (
                <div className="px-4 py-2 text-center font-label text-[10px] font-bold text-white/25 uppercase tracking-[1.5px] bg-white/[0.02] border-b border-white/[0.04]">
                  &#9654; Quarter {reversed[i - 1].quarter} Start
                </div>
              )}
              <div className="flex gap-3 px-4 py-3.5 border-b border-white/[0.04] items-center hover:bg-white/[0.03] transition-colors">
                {/* Team logo */}
                <div className="shrink-0">
                  <TeamBadge
                    team={{ name: entry.teamName, abbreviation: entry.teamAbbreviation, logoUrl: entry.teamLogoUrl ?? null }}
                    size={32}
                    variant={entry.isHomeTeam ? 'home' : 'away'}
                  />
                </div>

                {/* Entry content */}
                <div className="flex-1 min-w-0">
                  <p className="font-label text-[10px] font-bold text-white/35 uppercase">
                    {entry.time} &middot; Q{entry.quarter}
                  </p>
                  {entry.eventType === 'goal' ? (
                    <p className="font-body text-sm font-semibold text-white mt-0.5 leading-snug">
                      {entry.scorerName && entry.scorerPlayerId ? (
                        <Link
                          href={`/player/${entry.scorerPlayerId}`}
                          className="text-white underline decoration-white/25 underline-offset-2 hover:decoration-lime-400 hover:text-lime-400"
                        >
                          {entry.scorerName}
                        </Link>
                      ) : (
                        <span className="text-white">{entry.teamName}</span>
                      )}{' '}
                      <span className="text-white/50">scored</span>
                      {entry.scorePoints === 2 && (
                        <span className="ml-1.5 text-[10px] font-black uppercase tracking-wider text-amber-400 bg-amber-400/15 px-1.5 py-0.5 rounded">
                          Super
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="font-body text-sm font-semibold text-white mt-0.5 leading-snug">
                      {entry.playerName && entry.playerId ? (
                        <Link
                          href={`/player/${entry.playerId}`}
                          className="text-cyan-300 underline decoration-cyan-300/25 underline-offset-2 hover:decoration-cyan-400 hover:text-cyan-400"
                        >
                          {entry.playerName}
                        </Link>
                      ) : (
                        <span className="text-cyan-300">{entry.teamName}</span>
                      )}{' '}
                      <span className="text-white/50">intercept</span>
                    </p>
                  )}
                  <p className="font-label text-[10px] text-white/30 mt-0.5">
                    {entry.teamName}
                  </p>
                </div>

                {/* Score badge (only for goals) */}
                {entry.eventType === 'goal' && entry.homeScore != null && entry.awayScore != null ? (
                  <span
                    className={`shrink-0 font-label text-[11px] font-extrabold px-2 py-0.5 rounded tracking-[0.5px] ${
                      entry.isHomeTeam
                        ? 'bg-primary-container/60 text-primary-fixed-dim'
                        : 'bg-secondary/30 text-secondary-container'
                    }`}
                  >
                    {entry.homeScore} &ndash; {entry.awayScore}
                  </span>
                ) : (
                  <span className="shrink-0 material-symbols-outlined text-cyan-400/60 text-[18px]">
                    shield
                  </span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
