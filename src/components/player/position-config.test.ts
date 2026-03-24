import { describe, it, expect } from 'vitest';
import { getPositionConfig, type PositionGroup } from './position-config';

describe('getPositionConfig', () => {
  it('maps GS to shooter group', () => {
    const config = getPositionConfig('GS');
    expect(config.group).toBe('shooter');
  });

  it('maps GA to shooter group', () => {
    const config = getPositionConfig('GA');
    expect(config.group).toBe('shooter');
  });

  it('maps GK to defender group', () => {
    const config = getPositionConfig('GK');
    expect(config.group).toBe('defender');
  });

  it('maps GD to defender group', () => {
    const config = getPositionConfig('GD');
    expect(config.group).toBe('defender');
  });

  it('maps C to midcourt group', () => {
    const config = getPositionConfig('C');
    expect(config.group).toBe('midcourt');
  });

  it('maps WA to midcourt group', () => {
    const config = getPositionConfig('WA');
    expect(config.group).toBe('midcourt');
  });

  it('maps WD to midcourt group', () => {
    const config = getPositionConfig('WD');
    expect(config.group).toBe('midcourt');
  });

  it('shooter highlights include goals, shooting %, rebounds', () => {
    const config = getPositionConfig('GS');
    const keys = config.highlights.map(h => h.key);
    expect(keys).toContain('goals');
    expect(keys).toContain('shootingPct');
    expect(keys).toContain('rebounds');
  });

  it('defender highlights include intercepts, rebounds, deflections', () => {
    const config = getPositionConfig('GK');
    const keys = config.highlights.map(h => h.key);
    expect(keys).toContain('intercepts');
    expect(keys).toContain('rebounds');
    expect(keys).toContain('deflections');
  });

  it('midcourt highlights include goalAssists, feeds, centrePassReceives', () => {
    const config = getPositionConfig('C');
    const keys = config.highlights.map(h => h.key);
    expect(keys).toContain('goalAssists');
    expect(keys).toContain('feeds');
    expect(keys).toContain('centrePassReceives');
  });

  it('all positions have gameLogColumns defined', () => {
    const positions = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'] as const;
    for (const pos of positions) {
      expect(getPositionConfig(pos).gameLogColumns.length).toBeGreaterThan(0);
    }
  });
});
