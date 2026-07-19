import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteLoading } from '../RouteLoading';

describe('RouteLoading', () => {
  it('announces visible route-loading progress in a stable region', () => {
    render(<RouteLoading message="Loading competition edition…" />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveClass('min-h-[32rem]');
    expect(screen.getByText('Loading competition edition…')).toBeVisible();
  });

  it('does not introduce a second main landmark', () => {
    render(
      <main>
        <RouteLoading />
      </main>,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
