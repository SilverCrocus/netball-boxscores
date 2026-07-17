import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppError from '@/app/error';

describe('AppError', () => {
  it('distinguishes an unavailable page from an empty result and retries on request', () => {
    const reset = vi.fn();
    render(<AppError error={new Error('database unavailable')} reset={reset} />);

    expect(screen.getByRole('alert')).toHaveTextContent('This is not an empty result');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
