'use client';

import { usePathname } from 'next/navigation';
import { EditionSelector } from '@/components/competition/EditionSelector';
import type { EditionContextValue } from '@/lib/edition-context';
import { navigationEditionFromPathname } from '@/lib/edition-links';

interface GlobalEditionSelectorProps {
  editions: EditionContextValue[];
  surface?: 'desktop' | 'mobile';
  appearance?: 'surface' | 'dark';
}

export function GlobalEditionSelector({
  editions,
  surface = 'desktop',
  appearance = 'surface',
}: GlobalEditionSelectorProps) {
  const pathname = usePathname();

  if (editions.length === 0) return null;

  return (
    <EditionSelector
      current={navigationEditionFromPathname(editions, pathname)}
      editions={editions}
      surface={surface}
      appearance={appearance}
    />
  );
}
