'use client';

import { useState, Fragment } from 'react';
import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import type { MatchTimelineEntry } from '@/types/match-timeline';
import type { TeamInfoWithId } from '@/types/team';

export type PlayByPlayEntry = MatchTimelineEntry;

const FALLBACK_HOME = '#90b8f8';
const FALLBACK_AWAY = '#7de891';

const EVENT_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  goal: { label: 'scored', color: '', icon: '' },
  intercept: { label: 'intercept', color: 'text-cyan-700', icon: 'shield' },
  deflection: { label: 'deflection', color: 'text-violet-600', icon: 'front_hand' },
  rebound: { label: 'rebound', color: 'text-orange-600', icon: 'replay' },
  turnover: { label: 'turnover', color: 'text-red-600', icon: 'swap_horiz' },
};

interface MatchPlayByPlayProps {
  entries: PlayByPlayEntry[];
  homeTeam: TeamInfoWithId;
  awayTeam: TeamInfoWithId;
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
          <span aria-hidden="true" className="material-symbols-outlined text-sm">sports_score</span>
          Play by Play
        </h4>
        <button
          type="button"
          onClick={() => setChronological(!chronological)}
          className="flex items-center gap-1 text-[11px] font-label font-bold text-on-surface-variant uppercase tracking-wider hover:text-primary-container transition-colors cursor-pointer"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            {chronological ? 'arrow_downward' : 'arrow_upward'}
          </span>
          {chronological ? 'Oldest first' : 'Newest first'}
        </button>
      </div>

      <div className="max-h-[700px] overflow-y-auto">
        {sorted.map((entry, i) => {
          const isHome = entry.teamId === homeTeam.id;
          const team = isHome ? homeTeam : awayTeam;
          const teamColor = isHome
            ? (homeTeam.primaryColor || FALLBACK_HOME)
            : (awayTeam.primaryColor || FALLBACK_AWAY);
          const prev = i > 0 ? sorted[i - 1] : null;
          const showSeparator = prev !== null && prev.period !== entry.period;
          const separatorQuarter = chronological ? entry.period : prev?.period;
          const config = EVENT_CONFIG[entry.eventType];

          return (
            <Fragment key={entry.id}>
              {showSeparator && (
                <div className="px-4 py-2 text-center font-label text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-[1.5px] bg-surface-container-highest/30 border-y border-outline-variant/10">
                  Quarter {separatorQuarter}
                </div>
              )}
              <div
                className="flex gap-3 px-5 py-3 border-b border-outline-variant/10 items-center transition-colors"
                style={{
                  backgroundColor: `${teamColor}0D`,
                  borderLeft: `3px solid ${teamColor}`,
                }}
              >
                <div className="shrink-0 relative">
                  {entry.playerName && entry.playerId ? (
                    <div className="relative">
                      <PlayerAvatar
                        decorative
                        name={entry.playerName}
                        photoUrl={entry.playerPhotoUrl}
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
                    {entry.playerName && entry.playerId ? (
                      <Link
                        prefetch={false}
                        href={`/player/${entry.playerId}`}
                        className="text-on-surface underline decoration-on-surface/20 underline-offset-2 hover:decoration-primary-container hover:text-primary-container"
                      >
                        {entry.playerName}
                      </Link>
                    ) : (
                      <span>{team.name}</span>
                    )}
                    {' '}
                    <span className={`text-on-surface-variant ${config.color}`}>{config.label}</span>
                    {entry.eventType === 'goal' && entry.scorePoints === 2 && (
                      <span className="ml-1.5 text-[10px] font-black uppercase tracking-wider text-amber-600 bg-amber-400/15 px-1.5 py-0.5 rounded">
                        Super
                      </span>
                    )}
                  </p>
                </div>

                {entry.eventType === 'goal' && entry.homeScore != null && entry.awayScore != null ? (
                  <span
                    className={`shrink-0 font-label text-[11px] font-extrabold px-2 py-0.5 rounded tracking-[0.5px] ${
                      isHome
                        ? 'bg-primary-container/20 text-primary-container'
                        : 'bg-secondary/20 text-secondary'
                    }`}
                  >
                    {entry.homeScore} &ndash; {entry.awayScore}
                  </span>
                ) : config.icon ? (
                  <span aria-hidden="true" className={`shrink-0 material-symbols-outlined text-[18px] ${config.color} opacity-50`}>
                    {config.icon}
                  </span>
                ) : null}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
