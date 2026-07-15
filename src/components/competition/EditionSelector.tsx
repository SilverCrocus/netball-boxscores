'use client';

import { useId } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { EditionContextValue } from '@/lib/edition-context';
import { editionSwitchHref } from '@/lib/edition-links';

interface EditionSelectorProps {
  current: EditionContextValue;
  editions: EditionContextValue[];
  surface?: 'desktop' | 'mobile';
}

export function EditionSelector({
  current,
  editions,
  surface = 'desktop',
}: EditionSelectorProps) {
  const selectId = useId();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className={surface === 'mobile' ? 'w-full' : 'min-w-56'}>
      <label
        htmlFor={selectId}
        className="mb-1 block font-label text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface-variant"
      >
        Competition
      </label>
      <select
        id={selectId}
        aria-label="Competition edition"
        value={current.id}
        onChange={(event) => {
          const target = editions.find((edition) => edition.id === event.target.value);
          if (target) router.push(editionSwitchHref(target, pathname));
        }}
        className="min-h-11 w-full rounded-xl border border-outline-variant bg-surface-container px-3 font-headline text-sm font-semibold text-on-surface"
      >
        {editions.map((edition) => (
          <option key={edition.id} value={edition.id}>
            {edition.competitionName} — {edition.editionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
