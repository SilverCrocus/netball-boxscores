import Link from 'next/link';
import type { EditionContextValue } from '@/lib/edition-context';
import { editionHref, type EditionDestination } from '@/lib/edition-links';

interface TournamentSectionNavProps {
  edition: EditionContextValue;
  active: EditionDestination;
}
const SECTIONS: Array<{
  destination: EditionDestination;
  label: string;
  icon: string;
}> = [
  { destination: '', label: 'Overview', icon: 'home' },
  { destination: 'pools', label: 'Pools', icon: 'groups' },
  { destination: 'standings', label: 'Standings', icon: 'leaderboard' },
  { destination: 'bracket', label: 'Finals path', icon: 'account_tree' },
];

export function TournamentSectionNav({ edition, active }: TournamentSectionNavProps) {
  return (
    <nav
      aria-label={`${edition.editionLabel} tournament sections`}
      className="mb-6 overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest p-2 shadow-sm"
    >
      <ul className="flex min-w-max gap-1">
        {SECTIONS.map((section) => {
          const selected = active === section.destination;
          return (
            <li key={section.destination || 'overview'}>
              <Link
                href={editionHref(edition, section.destination)}
                prefetch={false}
                aria-current={selected ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-xl px-4 font-headline text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary ${
                  selected
                    ? 'bg-primary text-white shadow-md'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-primary'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[19px]">
                  {section.icon}
                </span>
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
