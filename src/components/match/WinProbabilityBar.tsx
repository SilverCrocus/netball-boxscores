'use client';

import { useMemo } from 'react';
import type { WinProbabilityResult } from '@/lib/win-probability-client';
import type { TeamInfo } from '@/types/team';

interface WinProbabilityBarProps {
  probability: WinProbabilityResult;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
}

const FALLBACK_HOME = '#90b8f8';
const FALLBACK_AWAY = '#7de891';

export function WinProbabilityBar({
  probability,
  homeTeam,
  awayTeam,
}: WinProbabilityBarProps) {
  const homeColor = homeTeam.primaryColor || FALLBACK_HOME;
  const awayColor = awayTeam.primaryColor || FALLBACK_AWAY;

  const homeWidth = useMemo(
    () => Math.max(8, probability.homeWinPct),
    [probability.homeWinPct],
  );
  const awayWidth = useMemo(() => 100 - homeWidth, [homeWidth]);

  const homePct = Math.round(probability.homeWinPct);
  const awayPct = Math.round(probability.awayWinPct);

  return (
    <div className="bg-surface-container-lowest rounded-xl px-4 py-3 shadow-sm border border-outline-variant/15">
      <div className="flex items-center justify-between mb-2">
        <span className="font-label text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">
          Win Probability
        </span>
        {probability.confidence === 'low' && (
          <span className="font-label text-[9px] text-on-surface-variant/40 uppercase">
            Early estimate
          </span>
        )}
      </div>

      {/* Percentage labels */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: homeColor }}
          />
          <span className="font-label text-xs font-bold text-on-surface">
            {homeTeam.abbreviation}
          </span>
          <span
            className="font-label text-sm font-bold"
            style={{ color: homeColor }}
          >
            {homePct}%
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="font-label text-sm font-bold"
            style={{ color: awayColor }}
          >
            {awayPct}%
          </span>
          <span className="font-label text-xs font-bold text-on-surface">
            {awayTeam.abbreviation}
          </span>
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: awayColor }}
          />
        </div>
      </div>

      {/* Bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
        <div
          className="rounded-l-full transition-all duration-700 ease-out"
          style={{
            width: `${homeWidth}%`,
            backgroundColor: homeColor,
          }}
        />
        <div
          className="rounded-r-full transition-all duration-700 ease-out"
          style={{
            width: `${awayWidth}%`,
            backgroundColor: awayColor,
          }}
        />
      </div>
    </div>
  );
}
