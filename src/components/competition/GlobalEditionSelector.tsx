'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { EditionSelector } from '@/components/competition/EditionSelector';
import type { EditionContextValue } from '@/lib/edition-context';
import { navigationEditionFromLocation } from '@/lib/edition-links';

interface GlobalEditionSelectorProps {
  editions: EditionContextValue[];
  surface?: 'desktop' | 'mobile';
  appearance?: 'surface' | 'dark';
  compact?: boolean;
}

export function GlobalEditionSelector({
  editions,
  surface = 'desktop',
  appearance = 'surface',
  compact = false,
}: GlobalEditionSelectorProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (editions.length === 0) return null;

  return (
    <EditionSelector
      current={navigationEditionFromLocation(editions, pathname, searchParams.get('edition'))}
      editions={editions}
      surface={surface}
      appearance={appearance}
      compact={compact}
    />
  );
}
