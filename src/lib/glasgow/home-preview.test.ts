import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGlasgowHomepagePreview,
  GLASGOW_UPSTREAM_PREVIEW_EDITION,
  SUNCORP_UPSTREAM_PREVIEW_EDITION,
  UPSTREAM_PREVIEW_EDITIONS,
} from '@/lib/glasgow/home-preview';

const originalUpstreamOrigin = process.env.CENTREPASS_UPSTREAM_ORIGIN;

afterEach(() => {
  if (originalUpstreamOrigin === undefined) {
    delete process.env.CENTREPASS_UPSTREAM_ORIGIN;
  } else {
    process.env.CENTREPASS_UPSTREAM_ORIGIN = originalUpstreamOrigin;
  }
});

describe('buildGlasgowHomepagePreview', () => {
  it('exposes the two editions that are published by the hosted preview origin', () => {
    expect(UPSTREAM_PREVIEW_EDITIONS).toEqual([
      GLASGOW_UPSTREAM_PREVIEW_EDITION,
      SUNCORP_UPSTREAM_PREVIEW_EDITION,
    ]);
    expect(GLASGOW_UPSTREAM_PREVIEW_EDITION).toMatchObject({
      competitionSlug: 'commonwealth-games-netball',
      editionSlug: 'glasgow-2026',
      navigationOrigin: 'https://www.centrepass.io',
    });
    expect(SUNCORP_UPSTREAM_PREVIEW_EDITION).toMatchObject({
      competitionSlug: 'suncorp-super-netball',
      editionSlug: '2026',
      navigationOrigin: 'https://www.centrepass.io',
    });
  });

  it('omits classification and semi-final fixtures until both teams are authoritative', () => {
    const preview = buildGlasgowHomepagePreview(new Date('2026-07-31T07:30:00.000Z'));

    expect(preview.fixtures).toEqual([]);
    expect(JSON.stringify(preview.fixtures)).not.toContain('TBD');
  });

  it('uses authoritative team sides for scheduled pool fixtures', () => {
    const preview = buildGlasgowHomepagePreview(new Date('2026-07-25T07:30:00.000Z'));

    expect(preview.fixtures[0]).toMatchObject({
      id: '2026-07-25-0900-nzl-sco',
      homeTeam: { name: 'New Zealand' },
      awayTeam: { name: 'Scotland' },
    });
  });

  it('omits unresolved medal fixtures instead of showing placeholder teams', () => {
    const preview = buildGlasgowHomepagePreview(new Date('2026-08-02T07:30:00.000Z'));

    expect(preview.fixtures).toEqual([]);
  });

  it('builds every preview navigation link from the configured normalized upstream origin', async () => {
    process.env.CENTREPASS_UPSTREAM_ORIGIN = 'https://preview.centrepass.example/some/path';
    vi.resetModules();
    const configuredPreview = await import('@/lib/glasgow/home-preview');
    const preview = configuredPreview.buildGlasgowHomepagePreview(
      new Date('2026-07-31T07:30:00.000Z'),
    );

    expect(configuredPreview.UPSTREAM_PREVIEW_EDITIONS.map((edition) => edition.navigationOrigin))
      .toEqual([
        'https://preview.centrepass.example',
        'https://preview.centrepass.example',
      ]);
    expect(preview.fixturesHref).toBe(
      'https://preview.centrepass.example/competitions/commonwealth-games-netball/glasgow-2026',
    );
    expect(preview.liveHref).toBe('https://preview.centrepass.example/live');
  });
});
