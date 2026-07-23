'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  getNavigationPrefetchPolicy,
  getVisibleNavigationItems,
  isResolvedNavigationActive,
  type NavItem,
} from '@/lib/navigation';
import { useLiveStatus } from '@/hooks/useLiveStatus';
import { AuthButton } from '@/components/auth/AuthButton';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { GlobalEditionSelector } from '@/components/competition/GlobalEditionSelector';
import { NavigationPendingIndicator } from '@/components/layout/NavigationPendingIndicator';
import { IntentPrefetchLink } from '@/components/layout/IntentPrefetchLink';
import type { EditionContextValue } from '@/lib/edition-context';
import {
  editionAwareNavigationHref,
  navigationEditionFromLocation,
} from '@/lib/edition-links';

export function Sidebar({
  editions = [],
  analyticsEnabled = false,
  askCentrePassEnabled = false,
}: {
  editions?: EditionContextValue[];
  analyticsEnabled?: boolean;
  askCentrePassEnabled?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasLive, minutesUntilNext } = useLiveStatus();
  const currentEdition = navigationEditionFromLocation(
    editions,
    pathname,
    searchParams.get('edition'),
  );
  const navigationItems = getVisibleNavigationItems({ analyticsEnabled, askCentrePassEnabled });

  return (
    <aside className="hidden lg:flex flex-col h-full w-[264px] fixed left-0 top-0 overflow-y-auto bg-slate-900 py-8 z-40 shadow-xl">
      <Link href="/" className="px-6 mb-8 flex items-center gap-3">
        <Image
          src="/netball-cleaned-white.png"
          alt=""
          width={500}
          height={453}
          priority
          className="h-8 w-auto"
          style={{ width: 'auto' }}
        />
        <span className="text-2xl font-black italic tracking-tighter text-white uppercase font-headline">
          CentrePass
        </span>
      </Link>
      <div className="mb-5 px-4">
        <GlobalSearch dark askCentrePassEnabled={askCentrePassEnabled} />
      </div>
      {editions.length > 0 && (
        <div className="mb-5 px-4">
          <GlobalEditionSelector editions={editions} appearance="dark" />
        </div>
      )}
      <nav className="flex flex-col gap-1">
        {navigationItems.map((item) => {
          const href = editionAwareNavigationHref(currentEdition, item.href);
          const active = isResolvedNavigationActive(pathname, item.href, href);
          return (
            <SidebarNavigationLink
              key={item.href}
              item={item}
              href={href}
              active={active}
              hasLive={hasLive}
              minutesUntilNext={minutesUntilNext}
            />
          );
        })}
      </nav>
      <section className="mt-auto border-t border-slate-800 px-5 pt-5" aria-label="Account">
        <p className="mb-3 font-label text-[10px] font-bold uppercase tracking-widest text-slate-500">Account</p>
        <AuthButton dark />
      </section>
    </aside>
  );
}

function SidebarNavigationLink({
  item,
  href,
  active,
  hasLive,
  minutesUntilNext,
}: {
  item: NavItem;
  href: string;
  active: boolean;
  hasLive: boolean;
  minutesUntilNext: number | null;
}) {
  const policy = getNavigationPrefetchPolicy(item.href);
  const className = `flex items-center gap-4 py-3 pl-4 border-l-4 transition-all font-headline font-medium text-sm ${
    active
      ? 'text-lime-400 border-lime-400 bg-slate-800/30'
      : 'text-slate-400 border-transparent hover:bg-slate-800'
  }`;
  const isLiveItem = item.href === '/live';
  const content = (
    <>
      <span aria-hidden="true" className="material-symbols-outlined">{item.icon}</span>
      <span className="flex items-center gap-2">
        {item.sidebarLabel ?? item.label}
        {isLiveItem && hasLive && (
          <>
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="sr-only">Match in progress</span>
          </>
        )}
        {isLiveItem && !hasLive && minutesUntilNext !== null && (
          <span aria-label={`Starts in ${minutesUntilNext} minutes`} className="text-[10px] text-lime-400 font-label font-bold uppercase">
            {minutesUntilNext}m
          </span>
        )}
      </span>
      <NavigationPendingIndicator
        label={item.sidebarLabel ?? item.label}
        className="ml-auto mr-4"
      />
    </>
  );

  if (policy === 'intent-full') {
    return (
      <IntentPrefetchLink href={href} policy={policy} className={className}>
        {content}
      </IntentPrefetchLink>
    );
  }

  if (policy === 'off') {
    return (
      <Link href={href} prefetch={false} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
