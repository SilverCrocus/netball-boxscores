'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getVisibleNavigationItems, isResolvedNavigationActive } from '@/lib/navigation';
import { useLiveStatus } from '@/hooks/useLiveStatus';
import { AuthButton } from '@/components/auth/AuthButton';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import type { EditionContextValue } from '@/lib/edition-context';
import {
  editionAwareNavigationHref,
  navigationEditionFromLocation,
} from '@/lib/edition-links';

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getOutsideModalTargets(modalLayer: HTMLElement) {
  const targets = new Set<HTMLElement>();
  let current: HTMLElement | null = modalLayer;

  while (current) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== current && sibling instanceof HTMLElement) {
        targets.add(sibling);
      }
    }
    if (parent === document.body) break;
    current = parent;
  }

  return Array.from(targets);
}

export function BottomNav({
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
  const [moreState, setMoreState] = useState({ pathname, open: false });
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const modalLayerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusOnCloseRef = useRef(false);
  if (moreState.pathname !== pathname) {
    setMoreState({ pathname, open: false });
  }
  const moreOpen = moreState.pathname === pathname && moreState.open;
  const navigationItems = getVisibleNavigationItems({ analyticsEnabled, askCentrePassEnabled });
  const primaryItems = navigationItems.filter((item) => !['/teams', '/explore'].includes(item.href));
  const moreItems = navigationItems.filter((item) => ['/explore', '/teams'].includes(item.href));
  const currentEdition = navigationEditionFromLocation(
    editions,
    pathname,
    searchParams.get('edition'),
  );
  const moreActive = moreItems.some((item) =>
    isResolvedNavigationActive(
      pathname,
      item.href,
      editionAwareNavigationHref(currentEdition, item.href),
    )
  );

  useEffect(() => {
    if (!moreOpen) return;
    const modalLayer = modalLayerRef.current;
    const dialog = dialogRef.current;
    if (!modalLayer || !dialog) return;

    const previousBodyOverflow = document.body.style.overflow;
    const moreButton = moreButtonRef.current;
    const outsideTargets = getOutsideModalTargets(modalLayer).map((element) => ({
      element,
      hadInert: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }));

    document.body.style.overflow = 'hidden';
    for (const { element } of outsideTargets) {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    }
    closeButtonRef.current?.focus();

    const handleDialogKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        restoreFocusOnCloseRef.current = true;
        setMoreState({ pathname, open: false });
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements.at(-1);
      if (!firstFocusable || !lastFocusable) return;

      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastFocusable : firstFocusable).focus();
      } else if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    const handleDocumentFocusIn = (event: FocusEvent) => {
      if (dialog.contains(event.target as Node)) return;
      const firstFocusable = dialog.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR);
      (firstFocusable ?? dialog).focus();
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    document.addEventListener('focusin', handleDocumentFocusIn);
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown);
      document.removeEventListener('focusin', handleDocumentFocusIn);
      document.body.style.overflow = previousBodyOverflow;
      for (const { element, hadInert, ariaHidden } of outsideTargets) {
        if (!hadInert) element.removeAttribute('inert');
        if (ariaHidden === null) {
          element.removeAttribute('aria-hidden');
        } else {
          element.setAttribute('aria-hidden', ariaHidden);
        }
      }
      if (restoreFocusOnCloseRef.current && moreButton?.isConnected) {
        moreButton.focus();
      }
      restoreFocusOnCloseRef.current = false;
    };
  }, [moreOpen, pathname]);

  function closeMore() {
    restoreFocusOnCloseRef.current = true;
    setMoreState({ pathname, open: false });
  }

  return (
    <>
      {moreOpen && (
        <div
          ref={modalLayerRef}
          data-testid="mobile-more-modal-layer"
          className="fixed inset-0 z-[55] lg:hidden"
        >
          <div aria-hidden="true" className="absolute inset-0 bg-slate-950/60" />
          <div
            ref={dialogRef}
            id="mobile-more-menu"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-heading"
            tabIndex={-1}
            style={{
              bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
              maxHeight: 'calc(100dvh - 6.5rem - env(safe-area-inset-bottom))',
              overscrollBehavior: 'contain',
            }}
            className="absolute inset-x-3 z-10 overflow-y-auto rounded-2xl border border-outline-variant/20 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-on-surface shadow-2xl"
          >
            <div className="sticky top-0 z-10 mb-4 flex items-center justify-between bg-white pb-2">
              <h2 id="mobile-more-heading" className="font-headline text-xl font-black uppercase">More</h2>
              <button ref={closeButtonRef} type="button" onClick={closeMore} aria-label="Close more menu" className="min-h-11 min-w-11 rounded-full text-on-surface-variant">
                <span aria-hidden="true" className="material-symbols-outlined">close</span>
              </button>
            </div>
            <GlobalSearch onNavigate={closeMore} askCentrePassEnabled={askCentrePassEnabled} />
            <div className="my-4 grid gap-2">
              {moreItems.map((item) => (
                <Link
                  key={item.href}
                  href={editionAwareNavigationHref(currentEdition, item.href)}
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
        </div>
      )}
      <nav className="fixed bottom-0 left-0 z-50 flex w-full items-center rounded-t-2xl border-t border-slate-800/50 bg-slate-950 px-1 pb-6 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.6)] lg:hidden">
      {primaryItems.map((item) => {
        const href = editionAwareNavigationHref(currentEdition, item.href);
        const active = isResolvedNavigationActive(pathname, item.href, href);
        const isLiveItem = item.href === '/live';
        return (
          <Link
            key={item.href}
            href={href}
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-1 py-1 transition-all ${
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
            <span className="max-w-full truncate font-label text-[8px] font-bold uppercase leading-tight tracking-[-0.03em]">
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
          onClick={() => {
            restoreFocusOnCloseRef.current = moreOpen;
            setMoreState({ pathname, open: !moreOpen });
          }}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-1 py-1 transition-all ${moreOpen || moreActive || pathname.startsWith('/settings') ? 'bg-lime-500 text-slate-950' : 'text-slate-500 hover:bg-slate-800'}`}
        >
          <span aria-hidden="true" className="material-symbols-outlined">more_horiz</span>
          <span className="font-label text-[8px] font-bold uppercase leading-tight tracking-[-0.03em]">More</span>
        </button>
      </nav>
    </>
  );
}
