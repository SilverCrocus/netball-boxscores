import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerAvatar } from '../PlayerAvatar';

describe('PlayerAvatar', () => {
  it('uses a named, high-contrast initials fallback when no photo exists', () => {
    render(<PlayerAvatar name="Maya Sterling" />);

    const fallback = screen.getByRole('img', { name: 'Maya Sterling' });
    expect(fallback).toHaveTextContent('MS');
    expect(fallback).toHaveClass('bg-primary-container', 'text-white');
  });

  it('falls back to initials if the supplied photo fails', () => {
    render(<PlayerAvatar name="Maya Sterling" photoUrl="/broken-player.png" />);

    fireEvent.error(screen.getByRole('img', { name: 'Maya Sterling' }));

    expect(screen.getByRole('img', { name: 'Maya Sterling' })).toHaveTextContent('MS');
  });
});
