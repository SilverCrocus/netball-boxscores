import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditionSelector } from '@/components/competition/EditionSelector';
import type { EditionContextValue } from '@/lib/edition-context';

const push = vi.fn();
let pathname = '/competitions/suncorp-super-netball/2026/teams';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
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
  beforeEach(() => {
    push.mockClear();
    pathname = '/competitions/suncorp-super-netball/2026/teams';
  });

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

  it('preserves a supported legacy section', () => {
    pathname = '/standings';
    render(<EditionSelector current={editions[0]} editions={editions} />);

    fireEvent.change(screen.getByLabelText('Competition edition'), {
      target: { value: 'glasgow' },
    });

    expect(push).toHaveBeenCalledWith(
      '/competitions/commonwealth-games/glasgow-2026/standings'
    );
  });

  it('shows an explicit unselected state for an unknown edition', () => {
    render(<EditionSelector current={null} editions={editions} />);

    expect(screen.getByLabelText('Competition edition')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Select competition' })).toBeDisabled();
  });

  it('keeps canonical switching behavior in the compact header appearance', () => {
    pathname = '/';
    render(
      <EditionSelector
        current={editions[0]}
        editions={editions}
        appearance="dark"
        compact
      />
    );

    fireEvent.change(screen.getByLabelText('Competition edition'), {
      target: { value: 'glasgow' },
    });

    expect(push).toHaveBeenCalledWith(
      '/competitions/commonwealth-games/glasgow-2026'
    );
  });

  it('sends an upstream-preview edition to its hosted page instead of a local database route', () => {
    pathname = '/';
    const previewEditions: EditionContextValue[] = editions.map((edition) => ({
      ...edition,
      id: `${edition.id}-preview`,
      navigationOrigin: 'https://www.centrepass.io',
    }));
    render(
      <EditionSelector
        current={previewEditions[1]}
        editions={previewEditions}
        appearance="dark"
        compact
      />
    );

    fireEvent.change(screen.getByLabelText('Competition edition'), {
      target: { value: 'ssn-preview' },
    });

    expect(push).toHaveBeenCalledWith(
      'https://www.centrepass.io/competitions/suncorp-super-netball/2026'
    );
  });
});
