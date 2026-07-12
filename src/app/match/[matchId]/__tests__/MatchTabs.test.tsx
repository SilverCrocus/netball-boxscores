import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchTabs } from '../MatchTabs';

describe('MatchTabs', () => {
  it('connects tabs to the active panel and switches on click', () => {
    render(
      <MatchTabs
        boxScore={<div>Box score content</div>}
        playByPlay={<div>Play by play content</div>}
        hasPlayByPlay
      />,
    );

    const boxScoreTab = screen.getByRole('tab', { name: 'Box Score' });
    const playByPlayTab = screen.getByRole('tab', { name: 'Play by Play' });
    expect(boxScoreTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Box Score');

    fireEvent.click(playByPlayTab);

    expect(playByPlayTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Play by Play');
    expect(screen.getByText('Play by play content')).toBeInTheDocument();
  });

  it('supports arrow-key tab navigation and focus', () => {
    render(
      <MatchTabs
        boxScore={<div>Box score content</div>}
        playByPlay={<div>Play by play content</div>}
        hasPlayByPlay
      />,
    );

    const boxScoreTab = screen.getByRole('tab', { name: 'Box Score' });
    const playByPlayTab = screen.getByRole('tab', { name: 'Play by Play' });
    boxScoreTab.focus();
    fireEvent.keyDown(boxScoreTab, { key: 'ArrowRight' });

    expect(playByPlayTab).toHaveFocus();
    expect(playByPlayTab).toHaveAttribute('aria-selected', 'true');
  });
});
