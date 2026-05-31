'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { PlayerStatRow } from '@/types/stats';
import type { TeamInfo } from '@/types/team';

interface TeamWithPlayers extends TeamInfo {
  players: PlayerStatRow[];
}

interface LiveLineupsProps {
  homeTeam: TeamWithPlayers;
  awayTeam: TeamWithPlayers;
  superShotsByPlayer?: Map<string, number>;
}

const POSITION_ORDER: Record<string, number> = {
  GS: 1, GA: 2, WA: 3, C: 4, WD: 5, GD: 6, GK: 7,
};

type StatColumn = 'G' | 'ATT' | 'AST' | 'INT' | 'FD';
type SortDirection = 'default' | 'desc' | 'asc';

interface SortState {
  column: 'player' | StatColumn;
  direction: SortDirection;
}

const STAT_KEY: Record<StatColumn, keyof PlayerStatRow> = {
  G: 'goals',
  ATT: 'attempts',
  AST: 'goalAssists',
  INT: 'intercepts',
  FD: 'feeds',
};

const COLUMN_TOOLTIPS: Record<StatColumn, string> = {
  G: 'Goals (Super Shots) — Successful shots scored',
  ATT: 'Attempts — Total shots taken',
  AST: 'Goal Assists — Passes to scorer',
  INT: 'Intercepts — Possessions won',
  FD: 'Feeds — Passes into circle',
};

const STAT_COLUMNS: StatColumn[] = ['G', 'ATT', 'AST', 'INT', 'FD'];

function isShooter(position: string): boolean {
  return position === 'GS' || position === 'GA';
}

const STANDARD_POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

function splitAndSort(
  players: PlayerStatRow[],
  sort: SortState,
): { onCourt: PlayerStatRow[]; bench: PlayerStatRow[] } {
  // Build a map: for each position, pick ONE player to be on court.
  // When multiple players share a position (substitution happened),
  // keep the one with fewer minutes (the replacement who came on later).
  // For positions with only one player, that player is always on court.
  const positionMap = new Map<string, PlayerStatRow>();

  // First pass: group players by position
  const byPosition = new Map<string, PlayerStatRow[]>();
  for (const p of players) {
    const group = byPosition.get(p.position) ?? [];
    group.push(p);
    byPosition.set(p.position, group);
  }

  // For each of the 7 standard positions, pick the on-court player
  for (const pos of STANDARD_POSITIONS) {
    const group = byPosition.get(pos);
    if (!group || group.length === 0) continue;

    if (group.length === 1) {
      // Only one player at this position — they're on court
      positionMap.set(pos, group[0]);
    } else {
      // Multiple players at this position — substitution occurred.
      // The player currently on court is the one with fewer minutes
      // (they came on later and have accumulated less time).
      // If no one has minutes yet, pick the first one.
      const withMinutes = group.filter((p) => p.minutesPlayed > 0);
      if (withMinutes.length === 0) {
        positionMap.set(pos, group[0]);
      } else if (withMinutes.length === 1) {
        positionMap.set(pos, withMinutes[0]);
      } else {
        // Pick the one with fewest minutes (most recently subbed on)
        const current = withMinutes.reduce((a, b) =>
          a.minutesPlayed <= b.minutesPlayed ? a : b,
        );
        positionMap.set(pos, current);
      }
    }
  }

  const onCourt = Array.from(positionMap.values());
  const onCourtIds = new Set(onCourt.map((p) => p.id));
  const bench = players.filter((p) => !onCourtIds.has(p.id));

  let sorted = [...onCourt];

  if (sort.direction === 'default') {
    // Default: GS → GK
    sorted.sort(
      (a, b) =>
        (POSITION_ORDER[a.position] ?? 99) -
        (POSITION_ORDER[b.position] ?? 99),
    );
  } else if (sort.column === 'player') {
    // GK → GS (defense first)
    sorted.sort(
      (a, b) =>
        (POSITION_ORDER[b.position] ?? 99) -
        (POSITION_ORDER[a.position] ?? 99),
    );
  } else {
    const key = STAT_KEY[sort.column as StatColumn];
    sorted.sort((a, b) => {
      const diff = (b[key] as number) - (a[key] as number);
      return sort.direction === 'desc' ? diff : -diff;
    });
  }

  return { onCourt: sorted, bench };
}

function TeamTable({
  team,
  variant,
  superShotsByPlayer,
}: {
  team: TeamWithPlayers;
  variant: 'home' | 'away';
  superShotsByPlayer?: Map<string, number>;
}) {
  const [sort, setSort] = useState<SortState>({
    column: 'player',
    direction: 'default',
  });

  const { onCourt, bench } = useMemo(
    () => splitAndSort(team.players, sort),
    [team.players, sort],
  );

  function handlePlayerSort() {
    setSort((prev) => {
      if (prev.column === 'player' && prev.direction !== 'default') {
        return { column: 'player', direction: 'default' };
      }
      return { column: 'player', direction: 'desc' };
    });
  }

  function handleStatSort(col: StatColumn) {
    setSort((prev) => {
      if (prev.column === col) {
        if (prev.direction === 'desc')
          return { column: col, direction: 'asc' };
        if (prev.direction === 'asc')
          return { column: col, direction: 'default' };
      }
      return { column: col, direction: 'desc' };
    });
  }

  const posClass =
    variant === 'home'
      ? 'bg-primary-container text-white'
      : 'bg-secondary text-white';
  const headerBorder =
    variant === 'home' ? 'border-secondary' : 'border-primary-container';
  const headerText =
    variant === 'home' ? 'text-secondary' : 'text-primary-container';
  const headerBg =
    variant === 'home' ? 'bg-secondary/[0.03]' : 'bg-primary-container/[0.03]';
  const headerAlign = variant === 'away' ? 'justify-end text-right' : '';

  function renderRow(player: PlayerStatRow, isBench: boolean) {
    const rowClass = isBench
      ? 'opacity-45 hover:opacity-70 transition-opacity'
      : 'hover:bg-surface-container-low transition-colors';
    const badgeOpacity = isBench ? 'opacity-35' : '';

    return (
      <tr key={player.id} className={rowClass}>
        <td className="pl-4 pr-2 py-2.5 border-b border-outline-variant/20">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-[30px] h-[30px] rounded-full ${posClass} flex items-center justify-center text-[10px] font-bold shrink-0 font-label ${badgeOpacity}`}
            >
              {player.position}
            </span>
            <Link
              href={`/player/${player.id}`}
              className={`font-body text-[13px] font-semibold hover:text-secondary hover:underline ${
                isBench ? 'text-on-surface-variant' : 'text-on-surface'
              }`}
            >
              {player.name}
            </Link>
          </div>
        </td>
        <td
          className={`text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] ${
            !isBench && isShooter(player.position)
              ? 'text-secondary font-extrabold'
              : 'text-on-surface-variant'
          }`}
        >
          {player.goals}
          {superShotsByPlayer?.get(player.id) ? (
            <span className="text-amber-500 font-bold text-[10px] ml-0.5">({superShotsByPlayer.get(player.id)})</span>
          ) : null}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.attempts}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.goalAssists}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.intercepts}
        </td>
        <td className="text-center px-1.5 py-2.5 border-b border-outline-variant/20 font-label text-[13px] text-on-surface-variant">
          {player.feeds}
        </td>
      </tr>
    );
  }

  return (
    <div>
      {/* Team column header */}
      <div
        className={`flex items-center gap-2 px-4 py-2.5 font-label text-[10px] font-black uppercase tracking-[1.5px] border-b-2 ${headerBorder} ${headerText} ${headerBg} ${headerAlign}`}
      >
        <div
          className={`w-[22px] h-[22px] rounded-full ${posClass} flex items-center justify-center text-[8px] font-bold`}
        >
          {team.abbreviation.slice(0, 2)}
        </div>
        {team.name}
      </div>

      {/* On Court group label */}
      <div className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-container-low border-b border-outline-variant font-label text-[9px] font-black uppercase tracking-[2px] text-on-surface-variant">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
        On Court
      </div>

      {/* Stats table */}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th
              className="text-left pl-4 pr-2 py-2 font-label text-[9px] font-bold uppercase tracking-[0.5px] text-on-surface-variant border-b border-outline-variant cursor-pointer hover:text-secondary select-none"
              style={{
                textDecoration: 'underline dotted rgba(67,71,78,0.4)',
                textUnderlineOffset: '3px',
              }}
              title="Position — Sort by court position"
              onClick={handlePlayerSort}
            >
              Player
              {sort.column === 'player' && sort.direction !== 'default' && (
                <span className="text-[8px] ml-0.5 text-secondary">
                  {' '}
                  GK→GS
                </span>
              )}
            </th>
            {STAT_COLUMNS.map((col) => (
              <th
                key={col}
                className="text-center px-1.5 py-2 font-label text-[9px] font-bold uppercase tracking-[0.5px] text-on-surface-variant border-b border-outline-variant cursor-pointer hover:text-secondary select-none"
                style={{
                  textDecoration: 'underline dotted rgba(67,71,78,0.4)',
                  textUnderlineOffset: '3px',
                }}
                title={COLUMN_TOOLTIPS[col]}
                onClick={() => handleStatSort(col)}
              >
                {col}
                {sort.column === col && sort.direction !== 'default' && (
                  <span className="text-[8px] ml-0.5 text-secondary">
                    {sort.direction === 'desc' ? ' ▼' : ' ▲'}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{onCourt.map((p) => renderRow(p, false))}</tbody>
      </table>

      {/* Bench */}
      {bench.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-container-low border-b border-outline-variant font-label text-[9px] font-black uppercase tracking-[2px] text-on-surface-variant opacity-50">
            Bench
          </div>
          <table className="w-full border-collapse">
            <tbody>{bench.map((p) => renderRow(p, true))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function LiveLineups({ homeTeam, awayTeam, superShotsByPlayer }: LiveLineupsProps) {
  const [selectedTeam, setSelectedTeam] = useState<'home' | 'away'>('home');

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/15 overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-secondary text-[22px]">
          groups
        </span>
        <h3 className="font-headline text-lg font-bold">Live Lineups</h3>
      </div>

      {/* Mobile team toggle */}
      <div className="md:hidden px-4 pb-3">
        <div className="flex rounded-full bg-surface-container p-1 gap-1">
          <button
            onClick={() => setSelectedTeam('home')}
            className={`flex-1 px-3 py-1.5 rounded-full text-xs font-label font-bold transition-colors ${
              selectedTeam === 'home'
                ? 'bg-secondary text-white'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {homeTeam.abbreviation}
          </button>
          <button
            onClick={() => setSelectedTeam('away')}
            className={`flex-1 px-3 py-1.5 rounded-full text-xs font-label font-bold transition-colors ${
              selectedTeam === 'away'
                ? 'bg-primary-container text-white'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {awayTeam.abbreviation}
          </button>
        </div>
      </div>

      {/* Desktop: side-by-side */}
      <div className="hidden md:grid md:grid-cols-2">
        <TeamTable team={homeTeam} variant="home" superShotsByPlayer={superShotsByPlayer} />
        <div className="border-l border-outline-variant">
          <TeamTable team={awayTeam} variant="away" superShotsByPlayer={superShotsByPlayer} />
        </div>
      </div>

      {/* Mobile: single team */}
      <div className="md:hidden">
        {selectedTeam === 'home' ? (
          <TeamTable team={homeTeam} variant="home" superShotsByPlayer={superShotsByPlayer} />
        ) : (
          <TeamTable team={awayTeam} variant="away" superShotsByPlayer={superShotsByPlayer} />
        )}
      </div>
    </div>
  );
}
