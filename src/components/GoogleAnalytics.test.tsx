import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname }));
vi.mock('next/script', () => ({
  default: ({ id, src }: { id?: string; src?: string }) => <div data-script data-testid={id ?? 'external-ga'} data-src={src} />,
}));

import { GoogleAnalytics } from '@/components/GoogleAnalytics';

describe('GoogleAnalytics private-route suppression', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('emits no analytics scripts anywhere under the private admin prefix', () => {
    vi.stubEnv('NEXT_PUBLIC_GA4_ID', 'G-TEST');
    usePathname.mockReturnValue('/admin/preview/glasgow-2026');
    const { container } = render(<GoogleAnalytics />);
    expect(container.querySelector('[data-script]')).toBeNull();
  });

  it('keeps analytics enabled for public pages', () => {
    vi.stubEnv('NEXT_PUBLIC_GA4_ID', 'G-TEST');
    usePathname.mockReturnValue('/competitions/ssn/2026');
    const { container } = render(<GoogleAnalytics />);
    expect(container.querySelectorAll('[data-script]')).toHaveLength(2);
  });
});
