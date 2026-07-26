import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OfficialLiveCentre } from '@/components/match/OfficialLiveCentre';

const src = 'https://crs-cg2026.glasgow2026.com/#/team-players/'
  + 'NBL/W/TEAM7-------------/GPA-/000400--';

describe('OfficialLiveCentre', () => {
  it('embeds the narrowly scoped official match view with a full-screen fallback', () => {
    render(<OfficialLiveCentre src={src} isLive />);

    expect(screen.getByRole('heading', {
      name: 'Official Glasgow 2026 live centre',
    })).toBeInTheDocument();
    expect(screen.getByText('Live official data')).toBeInTheDocument();

    const frame = screen.getByTitle(
      'Official Glasgow 2026 player statistics and play-by-play',
    );
    expect(frame).toHaveAttribute('src', src);
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');

    expect(screen.getByRole('link', { name: 'Open full screen' })).toHaveAttribute(
      'href',
      src,
    );
  });

  it('labels completed match data without claiming that it is live', () => {
    render(<OfficialLiveCentre src={src} isLive={false} />);

    expect(screen.getByText('Official match data')).toBeInTheDocument();
    expect(screen.queryByText('Live official data')).not.toBeInTheDocument();
  });
});
