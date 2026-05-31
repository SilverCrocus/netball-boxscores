'use client';

import { useState, Fragment } from 'react';
import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';

export interface PlayByPlayEntry {
  period: number;
  periodSeconds: number;
  scoringTeamId: string;
  homeScore: number;
  awayScore: number;
  scorePoints: number;
  scorerPlayerId?: string | null;
  scorerName?: string | null;
  scorerPhotoUrl?: string | null;
}

interface TeamInfo {
  id: string;
  name: string;
  abbreviation: string;
  logoUrl: string | null;
}

interface MatchPlayByPlayProps {
  entries: PlayByPlayEntry[];
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MatchPlayByPlay({ entries, homeTeam, awayTeam }: MatchPlayByPlayProps) {
  const [chronological, setChronological] = useState(false);

  const sorted = chronological ? entries : [...entries].reverse();

  return (
    <div className="bg-surface-container-low rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
        <h4 className="text-primary-container font-headline font-bold text-sm uppercase tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">sports_score</span>
          Play by Play
        </h4>
        <button
          onClick={() => setChronological(!chronological)}
          className="flex items-center gap-1 text-[11px] font-label font-bold text-on-surface-variant uppercase tracking-wider hover:text-primary-container transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">
            {chronological ? 'arrow_downward' : 'arrow_upward'}
          </span>
          {chronological ? 'Oldest first' : 'Newest first'}
        </button>
      </div>

      <div className="max-h-[700px] overflow-y-auto">
        {sorted.map((entry, i) => {
          const isHome = entry.scoringTeamId === homeTeam.id;
          const team = isHome ? homeTeam : awayTeam;
          const prev = i > 0 ? sorted[i - 1] : null;
          const showSeparator = prev !== null && prev.period !== entry.period;

          const separatorQuarter = chronological ? entry.period : prev?.period;

          return (
            <Fragment key={`${entry.period}-${entry.periodSeconds}`}>
              {showSeparator && (
                <div className="px-4 py-2 text-center font-label text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-[1.5px] bg-surface-container-highest/30 border-y border-outline-variant/10">
                  Quarter {separatorQuarter}
                </div>
              )}
              <div className={`flex gap-3 px-5 py-3 border-b border-outline-variant/10 items-center transition-colors ${
                isHome
                  ? 'bg-primary-container/[0.04] hover:bg-primary-container/[0.08]'
                  : 'bg-secondary/[0.04] hover:bg-secondary/[0.08]'
              }`}>
                <div className="shrink-0 relative">
                  {entry.scorerName && entry.scorerPlayerId ? (
                    <div className="relative">
                      <PlayerAvatar
                        name={entry.scorerName}
                        photoUrl={entry.scorerPhotoUrl}
                        size={32}
                      />
                      <div className="absolute -bottom-1 -right-1">
                        <TeamBadge
                          team={team}
                          size={16}
                          variant={isHome ? 'home' : 'away'}
                        />
                      </div>
                    </div>
                  ) : (
                    <TeamBadge
                      team={team}
                      size={32}
                      variant={isHome ? 'home' : 'away'}
                    />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-label text-[10px] font-bold text-on-surface-variant/60 uppercase">
                    {formatTime(entry.periodSeconds)} &middot; Q{entry.period}
                  </p>
                  <p className="font-body text-sm font-semibold text-on-surface mt-0.5 leading-snug">
                    {entry.scorerName && entry.scorerPlayerId ? (
                      <Link
                        href={`/player/${entry.scorerPlayerId}`}
                        className="text-on-surface underline decoration-on-surface/20 underline-offset-2 hover:decoration-primary-container hover:text-primary-container"
                      >
                        {entry.scorerName}
                      </Link>
                    ) : (
                      <span>{team.name}</span>
                    )}
                    {' '}
                    <span className="text-on-surface-variant">scored</span>
                    {entry.scorePoints === 2 && (
                      <span className="ml-1.5 text-[10px] font-black uppercase tracking-wider text-amber-600 bg-amber-400/15 px-1.5 py-0.5 rounded">
                        Super
                      </span>
                    )}
                  </p>
                </div>

                <span
                  className={`shrink-0 font-label text-[11px] font-extrabold px-2 py-0.5 rounded tracking-[0.5px] ${
                    isHome
                      ? 'bg-primary-container/20 text-primary-container'
                      : 'bg-secondary/20 text-secondary'
                  }`}
                >
                  {entry.homeScore} &ndash; {entry.awayScore}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
