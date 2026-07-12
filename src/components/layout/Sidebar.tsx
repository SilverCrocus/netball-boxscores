'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isActive } from '@/lib/navigation';
import { useLiveStatus } from '@/hooks/useLiveStatus';
import { AuthButton } from '@/components/auth/AuthButton';
import { GlobalSearch } from '@/components/search/GlobalSearch';

export function Sidebar() {
  const pathname = usePathname();
  const { hasLive, minutesUntilNext } = useLiveStatus();

  return (
    <aside className="hidden lg:flex flex-col h-full w-[264px] fixed left-0 top-0 bg-slate-900 py-8 z-40 shadow-xl">
      <Link href="/" className="px-6 mb-8 flex items-center gap-3">
        <Image
          src="/netball-cleaned-white.png"
          alt=""
          width={500}
          height={453}
          className="h-8 w-auto"
          style={{ width: 'auto' }}
        />
        <span className="text-2xl font-black italic tracking-tighter text-white uppercase font-headline">
          CentrePass
        </span>
      </Link>
      <div className="mb-5 px-4">
        <GlobalSearch dark />
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const isLiveItem = item.href === '/live';
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-4 py-3 pl-4 border-l-4 transition-all font-headline font-medium text-sm ${
                active
                  ? 'text-lime-400 border-lime-400 bg-slate-800/30'
                  : 'text-slate-400 border-transparent hover:bg-slate-800'
              }`}
            >
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
            </Link>
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
