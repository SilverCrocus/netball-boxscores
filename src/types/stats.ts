import type { StatValues } from '@/lib/stat-utils';

/** Player stat row used in box scores and live lineups */
export interface PlayerStatRow extends StatValues {
  id: string;
  name: string;
  position: string;
}
