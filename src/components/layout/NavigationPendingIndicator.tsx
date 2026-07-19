'use client';

import { useLinkStatus } from 'next/link';

interface NavigationPendingIndicatorProps {
  label: string;
  className?: string;
}

/**
 * Gives slow dynamic-route navigations an immediate, link-local acknowledgement.
 * The fixed box prevents labels from shifting when the indicator appears.
 */
export function NavigationPendingIndicator({
  label,
  className = '',
}: NavigationPendingIndicatorProps) {
  const { pending } = useLinkStatus();

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-navigation-pending={pending ? 'true' : 'false'}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${className}`}
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined text-[16px] leading-none transition-opacity duration-150 ${
          pending
            ? 'visible animate-spin opacity-100 delay-100'
            : 'invisible opacity-0 delay-0'
        }`}
      >
        progress_activity
      </span>
      <span className="sr-only">{pending ? `Loading ${label}` : ''}</span>
    </span>
  );
}
