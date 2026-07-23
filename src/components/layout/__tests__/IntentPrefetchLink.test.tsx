import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { IntentPrefetchLink } from '../IntentPrefetchLink';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => (
    <a href={href} data-prefetch={prefetch === true ? 'true' : 'false'} {...props}>
      {children}
    </a>
  ),
}));

function setConnection(connection: unknown) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: connection,
  });
}

describe('IntentPrefetchLink', () => {
  beforeEach(() => {
    setConnection({ saveData: false, effectiveType: '4g' });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'connection');
  });

  it.each([
    ['pointer', (link: HTMLElement) => fireEvent.pointerEnter(link)],
    ['mouse', (link: HTMLElement) => fireEvent.mouseEnter(link)],
    ['focus', (link: HTMLElement) => fireEvent.focus(link)],
    ['touch', (link: HTMLElement) => fireEvent.touchStart(link)],
  ])('enables full prefetch after %s intent', (_name, trigger) => {
    render(<IntentPrefetchLink href="/rankings">Rankings</IntentPrefetchLink>);
    const link = screen.getByRole('link', { name: 'Rankings' });

    expect(link).toHaveAttribute('data-prefetch', 'false');
    trigger(link);
    expect(link).toHaveAttribute('data-prefetch', 'true');
  });

  it.each([
    [{ saveData: true, effectiveType: '4g' }, 'Save-Data'],
    [{ saveData: false, effectiveType: 'slow-2g' }, 'slow-2g'],
    [{ saveData: false, effectiveType: '2g' }, '2g'],
  ])('keeps full prefetch disabled for %s connections', (connection) => {
    setConnection(connection);
    render(<IntentPrefetchLink href="/records">Records</IntentPrefetchLink>);
    const link = screen.getByRole('link', { name: 'Records' });

    fireEvent.pointerEnter(link);

    expect(link).toHaveAttribute('data-prefetch', 'false');
  });

  it('fails safely with no connection API and respects the explicit off policy', () => {
    Reflect.deleteProperty(navigator, 'connection');
    const { rerender } = render(<IntentPrefetchLink href="/rankings">Rankings</IntentPrefetchLink>);
    const rankings = screen.getByRole('link', { name: 'Rankings' });
    fireEvent.focus(rankings);
    expect(rankings).toHaveAttribute('data-prefetch', 'false');

    rerender(<IntentPrefetchLink href="/live" policy="off">Live</IntentPrefetchLink>);
    const live = screen.getByRole('link', { name: 'Live' });
    fireEvent.pointerEnter(live);
    expect(live).toHaveAttribute('data-prefetch', 'false');
  });

  it('preserves the native href and click/modifier event behavior', () => {
    const onClick = vi.fn();
    render(
      <IntentPrefetchLink href="/records" onClick={onClick}>
        Records
      </IntentPrefetchLink>,
    );
    const link = screen.getByRole('link', { name: 'Records' });

    fireEvent.click(link, { ctrlKey: true });

    expect(link).toHaveAttribute('href', '/records');
    expect(onClick).toHaveBeenCalledOnce();
  });
});
