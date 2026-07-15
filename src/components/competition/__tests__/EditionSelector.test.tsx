import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditionSelector } from '@/components/competition/EditionSelector';
import type { EditionContextValue } from '@/lib/edition-context';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/competitions/suncorp-super-netball/2026/teams',
  useRouter: () => ({ push }),
}));

const editions: EditionContextValue[] = [
  {
    id: 'ssn',
    competitionSlug: 'suncorp-super-netball',
    competitionName: 'Suncorp Super Netball',
    editionSlug: '2026',
    editionLabel: '2026',
    sourceTimezone: 'Australia/Sydney',
  },
  {
    id: 'glasgow',
    competitionSlug: 'commonwealth-games',
    competitionName: 'Commonwealth Games',
    editionSlug: 'glasgow-2026',
    editionLabel: 'Glasgow 2026',
    sourceTimezone: 'Europe/London',
  },
];

describe('EditionSelector', () => {
  beforeEach(() => push.mockClear());

  it.each(['desktop', 'mobile'] as const)(
    'preserves the current section on %s',
    (surface) => {
      render(
        <EditionSelector current={editions[0]} editions={editions} surface={surface} />
      );

      fireEvent.change(screen.getByLabelText('Competition edition'), {
        target: { value: 'glasgow' },
      });

      expect(push).toHaveBeenCalledWith(
        '/competitions/commonwealth-games/glasgow-2026/teams'
      );
    }
  );
});
