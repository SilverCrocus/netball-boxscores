import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TeamPageError from '../error';

describe('TeamPageError', () => {
  it('re-fetches the failed Server Component tree on retry', () => {
    const reset = vi.fn();
    const unstableRetry = vi.fn();

    render(
      <TeamPageError
        error={new Error('database unavailable')}
        reset={reset}
        unstable_retry={unstableRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Team details are temporarily unavailable',
    );
    expect(screen.getByRole('link', { name: 'Back to teams' })).toHaveAttribute(
      'href',
      '/teams',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(unstableRetry).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });
});
