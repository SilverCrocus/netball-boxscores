'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isActive } from '@/lib/navigation';
import { useLiveStatus } from '@/hooks/useLiveStatus';

export function BottomNav() {
  const pathname = usePathname();
  const { hasLive, minutesUntilNext } = useLiveStatus();
  const liveClickable = hasLive;

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pb-6 pt-2 bg-slate-950 rounded-t-2xl shadow-[0_-8px_24px_rgba(0,0,0,0.6)] border-t border-slate-800/50">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const isLiveItem = item.href === '/live';
        if (isLiveItem && !liveClickable) {
          return (
            <div
              key={item.href}
              className="relative flex flex-col items-center justify-center py-1 px-4 rounded-xl text-slate-700 cursor-not-allowed"
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="font-bold font-headline text-[10px] tracking-tight uppercase">
                {item.label}
              </span>
              {minutesUntilNext !== null && (
                <span className="absolute -top-1 -right-1 text-[8px] text-lime-400 font-label font-bold">
                  {minutesUntilNext}m
                </span>
              )}
            </div>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex flex-col items-center justify-center py-1 px-4 rounded-xl transition-all ${
              active
                ? 'bg-lime-500 text-slate-950 scale-105'
                : 'text-slate-500 hover:bg-slate-800'
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            <span className="font-bold font-headline text-[10px] tracking-tight uppercase">
              {item.label}
            </span>
            {isLiveItem && hasLive && (
              <span className="absolute top-0 right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            )}
            {isLiveItem && !liveClickable && minutesUntilNext !== null && (
              <span className="absolute -top-1 -right-1 text-[8px] text-lime-400 font-label font-bold">
                {minutesUntilNext}m
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
