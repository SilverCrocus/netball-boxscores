'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isActive } from '@/lib/navigation';
import { useLiveStatus } from '@/hooks/useLiveStatus';

export function Sidebar() {
  const pathname = usePathname();
  const { hasLive, minutesUntilNext } = useLiveStatus();

  return (
    <aside className="hidden lg:flex flex-col h-full w-[264px] fixed left-0 top-0 bg-slate-900 py-8 z-40 shadow-xl">
      <Link href="/" className="px-6 mb-8 flex items-center gap-3">
        <img src="/netball-cleaned-white.png" alt="" className="h-8 w-auto" />
        <span className="text-2xl font-black italic tracking-tighter text-white uppercase font-headline">
          CentrePass
        </span>
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const isLiveItem = item.href === '/live';
          if (isLiveItem && !hasLive) {
            return (
              <div
                key={item.href}
                className="flex items-center gap-4 py-3 pl-4 border-l-4 border-transparent text-slate-600 cursor-not-allowed font-headline font-medium text-sm"
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                <span className="flex items-center gap-2">
                  {item.sidebarLabel ?? item.label}
                  {minutesUntilNext !== null && (
                    <span className="text-[10px] text-lime-400 font-label font-bold uppercase">
                      {minutesUntilNext}m
                    </span>
                  )}
                </span>
              </div>
            );
          }

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
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="flex items-center gap-2">
                {item.sidebarLabel ?? item.label}
                {isLiveItem && hasLive && (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
                {isLiveItem && !hasLive && minutesUntilNext !== null && (
                  <span className="text-[10px] text-lime-400 font-label font-bold uppercase">
                    {minutesUntilNext}m
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
