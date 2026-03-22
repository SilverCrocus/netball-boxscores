import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LiveIndicator } from '../LiveIndicator';

describe('LiveIndicator', () => {
  it('renders LIVE text', () => {
    render(<LiveIndicator />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders pulsing dot', () => {
    const { container } = render(<LiveIndicator />);
    expect(container.querySelector('.animate-ping')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<LiveIndicator className="ml-2" />);
    expect(container.firstChild).toHaveClass('ml-2');
  });
});
