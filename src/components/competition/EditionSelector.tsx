'use client';

import { useId } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { EditionContextValue } from '@/lib/edition-context';
import { editionSwitchHref } from '@/lib/edition-links';

interface EditionSelectorProps {
  current?: EditionContextValue | null;
  editions: EditionContextValue[];
  surface?: 'desktop' | 'mobile';
  appearance?: 'surface' | 'dark';
  compact?: boolean;
}

export function EditionSelector({
  current,
  editions,
  surface = 'desktop',
  appearance = 'surface',
  compact = false,
}: EditionSelectorProps) {
  const selectId = useId();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className={surface === 'mobile' ? 'w-full' : compact ? 'w-[168px]' : 'min-w-56'}>
      <label
        htmlFor={selectId}
        className={`${compact ? 'sr-only' : 'mb-1 block'} font-label text-[11px] font-bold uppercase tracking-[0.16em] ${appearance === 'dark' ? 'text-slate-400' : 'text-on-surface-variant'}`}
      >
        Competition
      </label>
      <select
        id={selectId}
        aria-label="Competition edition"
        value={current?.id ?? ''}
        onChange={(event) => {
          const target = editions.find((edition) => edition.id === event.target.value);
          if (target) router.push(editionSwitchHref(target, pathname));
        }}
        className={`${compact ? 'min-h-10 rounded-lg px-3 text-[12px] uppercase tracking-[0.04em]' : 'min-h-11 rounded-xl px-3 text-sm'} w-full border font-headline font-semibold outline-none focus:ring-2 focus:ring-secondary-fixed ${appearance === 'dark' ? 'border-slate-600/80 bg-slate-900/70 text-white' : 'border-outline-variant bg-surface-container text-on-surface'}`}
      >
        {!current && <option value="" disabled>Select competition</option>}
        {editions.map((edition) => (
          <option key={edition.id} value={edition.id}>
            {edition.competitionName} — {edition.editionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
