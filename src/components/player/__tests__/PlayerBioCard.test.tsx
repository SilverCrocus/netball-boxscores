import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerBioCard } from '../PlayerBioCard';

describe('PlayerBioCard', () => {
  it('exposes and updates the expanded state for a long biography', () => {
    render(<PlayerBioCard biography={'A'.repeat(350)} />);

    const button = screen.getByRole('button', { name: 'Read more' });
    const biography = screen.getByText(/A{50}/);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', biography.id);

    fireEvent.click(button);

    expect(screen.getByRole('button', { name: 'Read less' })).toHaveAttribute('aria-expanded', 'true');
    expect(biography).toHaveTextContent('A'.repeat(350));
  });
});
