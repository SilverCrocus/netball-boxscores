import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationPendingIndicator } from '../NavigationPendingIndicator';

const linkStatus = vi.hoisted(() => ({ pending: false }));

vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: linkStatus.pending }),
}));

describe('NavigationPendingIndicator', () => {
  beforeEach(() => {
    linkStatus.pending = false;
  });

  it('reserves its space without announcing an idle navigation', () => {
    render(<NavigationPendingIndicator label="Teams" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-navigation-pending', 'false');
    expect(status).not.toHaveAttribute('aria-busy');
    expect(status.querySelector('.sr-only')).toBeEmptyDOMElement();
  });

  it('announces and animates the destination while navigation is pending', () => {
    linkStatus.pending = true;
    render(<NavigationPendingIndicator label="Teams" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-navigation-pending', 'true');
    expect(status).not.toHaveAttribute('aria-busy');
    expect(status).toHaveTextContent('Loading Teams');
    expect(screen.getByText('progress_activity')).toHaveClass('animate-spin', 'opacity-100');
  });
});
