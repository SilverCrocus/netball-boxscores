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

  it('falls back to static fixtures only when hosted fixtures are omitted', () => {
    const now = new Date('2026-07-25T07:30:00.000Z');

    expect(buildGlasgowHomepagePreview(now, undefined).fixtures[0]?.id)
      .toBe('2026-07-25-0900-nzl-sco');
    expect(buildGlasgowHomepagePreview(now, []).fixtures).toEqual([]);
  });

  it('uses hosted fixtures and their canonical match links instead of the static schedule', () => {
    const preview = buildGlasgowHomepagePreview(
      new Date('2026-07-25T07:30:00.000Z'),
      [{
        id: 'hosted-semi-final',
        competitionId: 'glasgow-2026',
        href: 'https://centrepass.example/match/hosted-semi-final?edition=glasgow-2026',
        status: 'SCHEDULED',
        scheduledAt: '2026-08-01T12:00:00.000Z',
        venue: 'The Hydro',
        homeTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
        awayTeam: { name: 'Scotland', abbreviation: 'SCO', logoUrl: null },
      }],
    );

    expect(preview.fixtures).toEqual([expect.objectContaining({
      id: 'hosted-semi-final',
      href: 'https://centrepass.example/match/hosted-semi-final?edition=glasgow-2026',
      homeTeam: { name: 'England', abbreviation: 'ENG', logoUrl: null },
      awayTeam: { name: 'Scotland', abbreviation: 'SCO', logoUrl: null },
    })]);
    expect(preview.fixtures.map((fixture) => fixture.id))
      .not.toContain('2026-07-25-0900-nzl-sco');
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
