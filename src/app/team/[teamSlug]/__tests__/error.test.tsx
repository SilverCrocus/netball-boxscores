import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TeamPageError from '../error';

describe('TeamPageError', () => {
  it('explains the retryable failure and retries on request', () => {
    const reset = vi.fn();

    render(<TeamPageError error={new Error('database unavailable')} reset={reset} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Team details are temporarily unavailable',
    );
    expect(screen.getByRole('link', { name: 'Back to teams' })).toHaveAttribute(
      'href',
      '/teams',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
