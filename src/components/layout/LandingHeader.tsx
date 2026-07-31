'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { AuthButton } from '@/components/auth/AuthButton';
import { GlobalEditionSelector } from '@/components/competition/GlobalEditionSelector';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import type { EditionContextValue } from '@/lib/edition-context';
import {
  editionHref,
  navigationEditionFromLocation,
} from '@/lib/edition-links';

interface LandingHeaderProps {
  editions: EditionContextValue[];
  analyticsEnabled: boolean;
  askCentrePassEnabled: boolean;
}

export function LandingHeader({
  editions,
  analyticsEnabled,
  askCentrePassEnabled,
}: LandingHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentEdition = navigationEditionFromLocation(
    editions,
    pathname,
    searchParams.get('edition'),
  );

  const navItems = currentEdition
    ? [
        { label: 'Matches', href: editionHref(currentEdition) },
        { label: 'Standings', href: editionHref(currentEdition, 'standings') },
        { label: 'Teams', href: editionHref(currentEdition, 'teams') },
        ...(analyticsEnabled
          ? [
              { label: 'Stats', href: '/rankings' },
              { label: 'Compare', href: '/compare/players' },
            ]
          : []),
      ]
    : [];

  return (
    <header className="relative z-50 border-b border-white/10 bg-[#020b18] text-white">
      <div className="mx-auto flex min-h-[72px] max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:min-h-[80px] lg:px-7">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5"
          aria-label="CentrePass home"
        >
          <Image
            src="/netball-cleaned-white.png"
            alt=""
            width={42}
            height={38}
            priority
            className="h-8 w-auto opacity-90"
            style={{ width: 'auto' }}
          />
          <span className={`${editions.length > 0 ? 'hidden sm:inline' : 'inline'} font-headline text-xl font-black uppercase italic tracking-[-0.06em] sm:text-2xl`}>
            CentrePass
          </span>
        </Link>

        {editions.length > 0 && (
          <div className="ml-auto min-w-0 lg:ml-2">
            <GlobalEditionSelector
              editions={editions}
              appearance="dark"
              compact
            />
          </div>
        )}

        <nav
          className="hidden items-center gap-7 px-4 lg:flex"
          aria-label="Landing page navigation"
        >
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              prefetch={item.href.startsWith('/compare') ? false : undefined}
              className="inline-flex min-h-11 items-center font-label text-[12px] font-bold text-white/80 transition-colors hover:text-secondary-fixed"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden w-[190px] shrink-0 xl:block">
          <GlobalSearch dark />
        </div>

        {askCentrePassEnabled && (
          <Link
            href="/explore"
            prefetch={false}
            className="hidden min-h-11 shrink-0 items-center gap-2 px-1 font-label text-[11px] font-bold uppercase tracking-wide text-secondary-fixed transition-colors hover:text-secondary-fixed-dim xl:flex"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">
              query_stats
            </span>
            Ask CentrePass
          </Link>
        )}

        <div className="hidden shrink-0 lg:block">
          <AuthButton dark compact />
        </div>
      </div>
    </header>
  );
}
