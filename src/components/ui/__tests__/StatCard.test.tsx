import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Total Goals" value="482" />);
    expect(screen.getByText('Total Goals')).toBeInTheDocument();
    expect(screen.getByText('482')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<StatCard label="Shooting" value="93%" subtitle="Season average" />);
    expect(screen.getByText('Season average')).toBeInTheDocument();
  });
});
