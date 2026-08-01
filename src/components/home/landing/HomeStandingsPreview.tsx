import Link from 'next/link';
import { TeamBadge } from '@/components/ui/TeamBadge';
import type { LandingTeam } from './types';

export interface HomeStandingRow {
  id: string;
  position: number | null;
  team: LandingTeam;
  played: number | null;
  won: number | null;
  lost: number | null;
  goalDifference: number | null;
  points: number | null;
}

export interface HomeStandingsPreviewProps {
  fullStandingsLink: {
    label: string;
    href: string;
  };
  title: string;
  rows: readonly HomeStandingRow[];
  note?: string;
}

function displayValue(value: number | null): string {
  return value == null ? '—' : String(value);
}

function LeagueStandingsPreview({
  title,
  rows,
  fullStandingsLink,
  note,
}: HomeStandingsPreviewProps) {
  return (
    <section aria-labelledby="home-standings-heading">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-4">
        <h2
          id="home-standings-heading"
          className="font-headline text-lg font-extrabold uppercase tracking-[-0.02em] text-primary sm:text-xl"
        >
          {title}
        </h2>
        <Link
          href={fullStandingsLink.href}
          prefetch={false}
          aria-label={fullStandingsLink.label}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 px-1 font-label text-[0.65rem] font-bold uppercase tracking-[0.05em] text-secondary hover:text-on-secondary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
        >
          <span className="hidden sm:inline">{fullStandingsLink.label}</span>
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            chevron_right
          </span>
        </Link>
      </div>

      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">{title}</caption>
        <colgroup>
          <col className="w-8 sm:w-10" />
          <col />
          <col className="w-7 sm:w-9" />
          <col className="w-7 sm:w-9" />
          <col className="w-7 sm:w-9" />
          <col className="w-9 sm:w-11" />
          <col className="w-8 sm:w-10" />
        </colgroup>
        <thead>
          <tr className="border-b border-outline-variant/70 font-label text-[0.58rem] uppercase text-on-surface-variant">
            <th scope="col" className="h-8 font-medium">Pos</th>
            <th scope="col" className="h-8 px-1 font-medium">Team</th>
            <th scope="col" className="h-8 text-center font-medium">P</th>
            <th scope="col" className="h-8 text-center font-medium">W</th>
            <th scope="col" className="h-8 text-center font-medium">L</th>
            <th scope="col" className="h-8 text-center font-medium">GD</th>
            <th scope="col" className="h-8 text-center font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 6).map((row) => (
            <tr key={row.id} className="border-b border-outline-variant/55 last:border-b-0">
              <td className="h-10 font-headline text-xs font-bold text-primary">
                {displayValue(row.position)}
              </td>
              <th scope="row" className="h-10 min-w-0 px-1">
                <span className="flex min-w-0 items-center gap-2">
                  <TeamBadge team={row.team} size={24} className="shrink-0" />
                  <span
                    className="truncate font-headline text-[0.65rem] font-bold uppercase text-primary sm:text-xs"
                    title={row.team.name}
                  >
                    {row.team.name}
                  </span>
                </span>
              </th>
              <td className="h-10 text-center font-label text-[0.65rem] font-semibold text-primary">
                {displayValue(row.played)}
              </td>
              <td className="h-10 text-center font-label text-[0.65rem] font-semibold text-primary">
                {displayValue(row.won)}
              </td>
              <td className="h-10 text-center font-label text-[0.65rem] font-semibold text-primary">
                {displayValue(row.lost)}
              </td>
              <td className="h-10 text-center font-label text-[0.65rem] font-semibold text-primary">
                {displayValue(row.goalDifference)}
              </td>
              <td className="h-10 text-center font-label text-[0.65rem] font-bold text-secondary">
                {displayValue(row.points)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {note && (
        <p className="mt-3 font-label text-[0.65rem] text-on-surface-variant">
          {note}
        </p>
      )}
    </section>
  );
}

export function HomeStandingsPreview(props: HomeStandingsPreviewProps) {
  return <LeagueStandingsPreview {...props} />;
}
