'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, type ComponentProps } from 'react';
import type { NavigationPrefetchPolicy } from '@/lib/navigation';

type ConnectionInformation = {
  saveData?: boolean;
  effectiveType?: string;
};

export function isIntentPrefetchAllowed(
  connection: ConnectionInformation | null | undefined,
): boolean {
  if (!connection) return false;
  if (connection.saveData === true) return false;
  return !['slow-2g', '2g'].includes(connection.effectiveType ?? '');
}

function getConnectionInformation(): ConnectionInformation | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { connection?: ConnectionInformation }).connection ?? null;
}

export type IntentPrefetchLinkProps = Omit<ComponentProps<typeof Link>, 'prefetch'> & {
  policy?: NavigationPrefetchPolicy;
};

/**
 * A native Next Link that starts with viewport/hover prefetch disabled and
 * enables a full prefetch only after a real intent signal on an unconstrained
 * connection. It never intercepts navigation or calls router.push.
 */
export function IntentPrefetchLink({
  policy = 'intent-full',
  onPointerEnter,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps) {
  const [prefetchEnabled, setPrefetchEnabled] = useState(false);
  const enabledRef = useRef(false);

  const enablePrefetch = useCallback(() => {
    if (policy !== 'intent-full' || enabledRef.current) return;
    if (!isIntentPrefetchAllowed(getConnectionInformation())) return;
    enabledRef.current = true;
    setPrefetchEnabled(true);
  }, [policy]);

  return (
    <Link
      {...props}
      prefetch={prefetchEnabled}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        enablePrefetch();
      }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        enablePrefetch();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        enablePrefetch();
      }}
      onTouchStart={(event) => {
        onTouchStart?.(event);
        enablePrefetch();
      }}
    />
  );
}
