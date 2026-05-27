'use client';

import { useState } from 'react';

const LEGEND_ITEMS = [
  { abbr: 'MIN', full: 'Minutes Played', category: 'general' as const },
  { abbr: 'G', full: 'Goals — goals scored', category: 'attack' as const },
  { abbr: 'ATT', full: 'Attempts — shots at goal', category: 'attack' as const },
  { abbr: 'G%', full: 'Goal Percentage — goals ÷ attempts', category: 'attack' as const },
  { abbr: 'AST', full: 'Goal Assists — pass to the shooter who scores', category: 'attack' as const },
  { abbr: 'FD', full: 'Feeds — passes into the goal circle', category: 'attack' as const },
  { abbr: 'CPR', full: 'Centre Pass Receives — first pass after a centre pass', category: 'attack' as const },
  { abbr: 'INT', full: 'Intercepts — gains possession from opponent\'s pass', category: 'defence' as const },
  { abbr: 'DEF', full: 'Deflections — touches the ball without gaining possession', category: 'defence' as const },
  { abbr: 'REB', full: 'Rebounds — retrieves ball after a missed shot', category: 'defence' as const },
  { abbr: 'PEN', full: 'Penalties — penalties conceded (contact, obstruction, etc.)', category: 'general' as const },
  { abbr: 'TO', full: 'Turnovers — loses possession to the other team', category: 'general' as const },
];

const CATEGORY_COLORS = {
  attack: 'text-secondary',
  defence: 'text-cyan-600',
  general: 'text-on-surface-variant',
};

export function StatsLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs font-label font-bold text-on-surface-variant uppercase tracking-widest px-4 py-2"
      >
        <span className="material-symbols-outlined text-sm">
          {open ? 'expand_less' : 'help_outline'}
        </span>
        {open ? 'Hide legend' : 'Stat legend'}
      </button>
      {open && (
        <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.abbr} className="flex items-center gap-1.5 text-xs">
              <span className={`font-bold font-label ${CATEGORY_COLORS[item.category]}`}>
                {item.abbr}
              </span>
              <span className="text-on-surface-variant">{item.full}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
