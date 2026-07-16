import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedCompetitionImport } from '@/lib/sources/types';

const bundlePath = path.resolve('data/glasgow-2026/v1/bundle.json');
const manifestPath = path.resolve('data/glasgow-2026/v1/source-manifest.json');

async function loadSourceBundle() {
  const bundleText = await readFile(bundlePath, 'utf8');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    bundleFileSha256: string;
    declarations: {
      publicationStatusRequired: string;
      matchCoverage: { unresolvedSlots: number };
    };
  };
  return {
    bundleText,
    bundle: JSON.parse(bundleText) as NormalizedCompetitionImport,
    manifest,
  };
}

describe('Glasgow 2026 source bundle', () => {
  it('matches the audited file checksum and stays gated as draft', async () => {
    const { bundleText, manifest } = await loadSourceBundle();

    expect(createHash('sha256').update(bundleText).digest('hex')).toBe(manifest.bundleFileSha256);
    expect(manifest.declarations.publicationStatusRequired).toBe('DRAFT');
  });

  it('contains the complete tournament structure without inventing unresolved teams', async () => {
    const { bundle, manifest } = await loadSourceBundle();
    const countsByStage = Object.groupBy(bundle.matches, (match) => match.stageSlug);
    const unresolvedSlots = bundle.matches.flatMap((match) => [match.sideA, match.sideB])
      .filter((side) => side.sourceType === 'UNRESOLVED');

    expect(bundle.teams).toHaveLength(12);
    expect(bundle.teams.filter((team) => team.groupSlug === 'pool-a')).toHaveLength(6);
    expect(bundle.teams.filter((team) => team.groupSlug === 'pool-b')).toHaveLength(6);
    expect(bundle.matches).toHaveLength(38);
    expect(countsByStage['pool-stage']).toHaveLength(30);
    expect(countsByStage.classification).toHaveLength(4);
    expect(countsByStage['semi-finals']).toHaveLength(2);
    expect(countsByStage['medal-matches']).toHaveLength(2);
    expect(unresolvedSlots).toHaveLength(manifest.declarations.matchCoverage.unresolvedSlots);
    expect(unresolvedSlots.every((slot) => slot.sourceLabel && !slot.teamExternalId)).toBe(true);
    expect(bundle.matches.every((match) => match.scheduledAt.endsWith('Z'))).toBe(true);
    expect(bundle.matches.every((match) => match.venue === 'The Hydro')).toBe(true);
  });

  it('imports only position-supported squads and complete photo provenance', async () => {
    const { bundle } = await loadSourceBundle();
    const playerCounts = Object.groupBy(bundle.players, (player) => player.teamExternalId);
    const playersWithPhotos = bundle.players.filter((player) => player.photoUrl);

    expect(bundle.players).toHaveLength(48);
    expect(bundle.rosters).toHaveLength(48);
    expect(Object.keys(playerCounts).sort()).toEqual(['ENG', 'NZL', 'SCO', 'WAL']);
    expect(Object.values(playerCounts).every((players) => players?.length === 12)).toBe(true);
    expect(bundle.players).toContainEqual(expect.objectContaining({
      externalId: 'WAL-phillipa-yarranton',
      name: 'Phillipa Yarranton',
    }));
    expect(bundle.players.some((player) => player.name === 'Philippa Yarranton')).toBe(false);
    expect(bundle.rosters).toContainEqual(expect.objectContaining({
      playerExternalId: 'WAL-phillipa-yarranton',
    }));
    expect(playersWithPhotos).toHaveLength(3);
    expect(playersWithPhotos.every((player) => (
      player.photoSourceUrl
      && player.photoCredit
      && player.photoLicense === 'CC BY-SA 4.0'
      && player.photoVerifiedAt
    ))).toBe(true);
    expect(bundle.results).toEqual([]);
    expect(bundle.coverage.every((coverage) => coverage.state === 'UNAVAILABLE')).toBe(true);
  });
});
