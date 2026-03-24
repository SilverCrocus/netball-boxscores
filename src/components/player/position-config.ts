import type { Position } from '@prisma/client';

export type PositionGroup = 'shooter' | 'defender' | 'midcourt';

export interface StatHighlight {
  key: string;
  label: string;
  /** Field name on PlayerMatchStats, or 'shootingPct' for computed */
  statField: string;
  format?: 'percentage' | 'number';
}

export interface GameLogColumn {
  key: string;
  label: string;
  abbrev: string;
  statField: string;
  format?: 'percentage' | 'number';
}

export interface PositionConfig {
  group: PositionGroup;
  highlights: StatHighlight[];
  gameLogColumns: GameLogColumn[];
  /** Field used for the main bar chart */
  primaryChartStat: string;
  primaryChartLabel: string;
}

const COMMON_COLUMNS: GameLogColumn[] = [
  { key: 'date', label: 'Date', abbrev: 'Date', statField: '_date' },
  { key: 'opponent', label: 'Opponent', abbrev: 'Opp', statField: '_opponent' },
  { key: 'result', label: 'Result', abbrev: 'Result', statField: '_result' },
];

const SHOOTER_CONFIG: PositionConfig = {
  group: 'shooter',
  highlights: [
    { key: 'goals', label: 'Goals Scored', statField: 'goals' },
    { key: 'shootingPct', label: 'Shooting %', statField: 'shootingPct', format: 'percentage' },
    { key: 'rebounds', label: 'Rebounds', statField: 'rebounds' },
  ],
  gameLogColumns: [
    ...COMMON_COLUMNS,
    { key: 'goals', label: 'Goals', abbrev: 'G', statField: 'goals' },
    { key: 'attempts', label: 'Attempts', abbrev: 'Att', statField: 'attempts' },
    { key: 'accuracy', label: 'Accuracy', abbrev: 'Acc%', statField: 'shootingPct', format: 'percentage' },
    { key: 'rebounds', label: 'Rebounds', abbrev: 'Reb', statField: 'rebounds' },
    { key: 'feeds', label: 'Feeds', abbrev: 'Fds', statField: 'feeds' },
  ],
  primaryChartStat: 'goals',
  primaryChartLabel: 'Goals',
};

const DEFENDER_CONFIG: PositionConfig = {
  group: 'defender',
  highlights: [
    { key: 'intercepts', label: 'Intercepts', statField: 'intercepts' },
    { key: 'rebounds', label: 'Rebounds', statField: 'rebounds' },
    { key: 'deflections', label: 'Deflections', statField: 'deflections' },
  ],
  gameLogColumns: [
    ...COMMON_COLUMNS,
    { key: 'intercepts', label: 'Intercepts', abbrev: 'Int', statField: 'intercepts' },
    { key: 'deflections', label: 'Deflections', abbrev: 'Def', statField: 'deflections' },
    { key: 'rebounds', label: 'Rebounds', abbrev: 'Reb', statField: 'rebounds' },
    { key: 'penalties', label: 'Penalties', abbrev: 'Pen', statField: 'penalties' },
    { key: 'turnovers', label: 'Turnovers', abbrev: 'TO', statField: 'turnovers' },
  ],
  primaryChartStat: 'intercepts',
  primaryChartLabel: 'Intercepts',
};

const MIDCOURT_CONFIG: PositionConfig = {
  group: 'midcourt',
  highlights: [
    { key: 'goalAssists', label: 'Goal Assists', statField: 'goalAssists' },
    { key: 'feeds', label: 'Feeds', statField: 'feeds' },
    { key: 'centrePassReceives', label: 'Centre Pass Receives', statField: 'centrePassReceives' },
  ],
  gameLogColumns: [
    ...COMMON_COLUMNS,
    { key: 'goalAssists', label: 'Goal Assists', abbrev: 'GA', statField: 'goalAssists' },
    { key: 'feeds', label: 'Feeds', abbrev: 'Fds', statField: 'feeds' },
    { key: 'cpr', label: 'Centre Pass Receives', abbrev: 'CPR', statField: 'centrePassReceives' },
    { key: 'intercepts', label: 'Intercepts', abbrev: 'Int', statField: 'intercepts' },
    { key: 'turnovers', label: 'Turnovers', abbrev: 'TO', statField: 'turnovers' },
  ],
  primaryChartStat: 'goalAssists',
  primaryChartLabel: 'Goal Assists',
};

const POSITION_MAP: Record<Position, PositionConfig> = {
  GS: SHOOTER_CONFIG,
  GA: SHOOTER_CONFIG,
  WA: MIDCOURT_CONFIG,
  C: MIDCOURT_CONFIG,
  WD: MIDCOURT_CONFIG,
  GD: DEFENDER_CONFIG,
  GK: DEFENDER_CONFIG,
};

export function getPositionConfig(position: Position): PositionConfig {
  return POSITION_MAP[position];
}
