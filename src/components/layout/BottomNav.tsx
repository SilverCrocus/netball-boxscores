'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV_ITEMS, isActive } from '@/lib/navigation';
import { useLiveStatus } from '@/hooks/useLiveStatus';
import { AuthButton } from '@/components/auth/AuthButton';
import { GlobalSearch } from '@/components/search/GlobalSearch';

export function BottomNav() {
  const pathname = usePathname();
  const { hasLive, minutesUntilNext } = useLiveStatus();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const primaryItems = NAV_ITEMS.filter((item) => !['/teams', '/explore'].includes(item.href));
  const moreItems = NAV_ITEMS.filter((item) => ['/explore', '/teams'].includes(item.href));

  useEffect(() => {
    if (!moreOpen) return;
    closeButtonRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [moreOpen]);

  function closeMore() {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  }

  return (
    <>
      {moreOpen && (
        <div
          id="mobile-more-menu"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-more-heading"
          className="fixed inset-x-3 bottom-24 z-[60] rounded-2xl border border-outline-variant/20 bg-white p-5 text-on-surface shadow-2xl lg:hidden"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id="mobile-more-heading" className="font-headline text-xl font-black uppercase">More</h2>
            <button ref={closeButtonRef} type="button" onClick={closeMore} aria-label="Close more menu" className="min-h-11 min-w-11 rounded-full text-on-surface-variant">
              <span aria-hidden="true" className="material-symbols-outlined">close</span>
            </button>
          </div>
          <GlobalSearch onNavigate={closeMore} />
          <div className="my-4 grid gap-2">
            {moreItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMore}
                className="flex min-h-11 items-center gap-3 rounded-xl bg-surface-container-low px-4 font-headline text-sm font-bold"
              >
                <span aria-hidden="true" className="material-symbols-outlined">{item.icon}</span>
                {item.href === '/teams' ? 'Browse teams' : 'Ask CentrePass'}
              </Link>
            ))}
          </div>
          <div className="border-t border-outline-variant/20 pt-4">
            <AuthButton onNavigate={closeMore} />
          </div>
        </div>
      )}
      <nav className="fixed bottom-0 left-0 z-50 flex w-full items-center justify-around rounded-t-2xl border-t border-slate-800/50 bg-slate-950 px-4 pb-6 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.6)] lg:hidden">
      {primaryItems.map((item) => {
        const active = isActive(pathname, item.href);
        const isLiveItem = item.href === '/live';
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
              aria-hidden="true"
              className="material-symbols-outlined"
              style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {item.icon}
            </span>
            <span className="font-bold font-headline text-[10px] tracking-tight uppercase">
              {item.label}
            </span>
            {isLiveItem && hasLive && (
              <>
                <span aria-hidden="true" className="absolute top-0 right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="sr-only">Match in progress</span>
              </>
            )}
            {isLiveItem && !hasLive && minutesUntilNext !== null && (
              <span aria-label={`Starts in ${minutesUntilNext} minutes`} className="absolute -top-1 -right-1 text-[8px] text-lime-400 font-label font-bold">
                {minutesUntilNext}m
              </span>
            )}
          </Link>
        );
      })}
        <button
          ref={moreButtonRef}
          type="button"
          aria-expanded={moreOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setMoreOpen((open) => !open)}
          className={`relative flex flex-col items-center justify-center rounded-xl px-4 py-1 transition-all ${moreOpen || pathname.startsWith('/teams') || pathname.startsWith('/explore') || pathname.startsWith('/settings') ? 'bg-lime-500 text-slate-950' : 'text-slate-500 hover:bg-slate-800'}`}
        >
          <span aria-hidden="true" className="material-symbols-outlined">more_horiz</span>
          <span className="font-headline text-[10px] font-bold uppercase tracking-tight">More</span>
        </button>
      </nav>
    </>
  );
}
