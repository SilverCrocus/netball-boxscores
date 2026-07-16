import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedCompetitionImport } from '@/lib/sources/types';
import nextConfig from '../../../next.config';

const bundlePath = path.resolve('data/glasgow-2026/v1/bundle.json');
const manifestPath = path.resolve('data/glasgow-2026/v1/source-manifest.json');

async function loadSourceBundle() {
  const bundleText = await readFile(bundlePath, 'utf8');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    bundleFileSha256: string;
    declarations: {
      publicationStatusRequired: string;
      publicationBlockers: string[];
      matchCoverage: { unresolvedSlots: number; dependentSlots: number };
    };
  };
  return {
    bundleText,
    bundle: JSON.parse(bundleText) as NormalizedCompetitionImport,
    manifest,
  };
}

describe('Glasgow 2026 source bundle', () => {
  it('matches the audited file checksum and has no remaining public-surface blockers', async () => {
    const { bundleText, manifest } = await loadSourceBundle();

    expect(createHash('sha256').update(bundleText).digest('hex')).toBe(manifest.bundleFileSha256);
    expect(manifest.declarations.publicationStatusRequired).toBe('DRAFT');
    expect(manifest.declarations.publicationBlockers).toEqual([]);
  });

  it('contains the complete tournament structure without inventing unresolved teams', async () => {
    const { bundle, manifest } = await loadSourceBundle();
    const countsByStage = Object.groupBy(bundle.matches, (match) => match.stageSlug);
    const unresolvedSlots = bundle.matches.flatMap((match) => [match.sideA, match.sideB])
      .filter((side) => side.sourceType === 'UNRESOLVED');
    const dependentSlots = bundle.matches.flatMap((match) => [match.sideA, match.sideB])
      .filter((side) => side.sourceType === 'MATCH_WINNER' || side.sourceType === 'MATCH_LOSER');
    const poolMatches = bundle.matches.filter((match) => match.stageSlug === 'pool-stage');
    const bronzeMatch = bundle.matches.find((match) => match.externalId === '2026-08-02-0900-bronze-medal');
    const goldMatch = bundle.matches.find((match) => match.externalId === '2026-08-02-1300-gold-medal');

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
    expect(dependentSlots).toHaveLength(manifest.declarations.matchCoverage.dependentSlots);
    expect(poolMatches.every((match) => match.round === undefined)).toBe(true);
    expect(poolMatches.every((match) => match.roundLabel?.startsWith('Pool '))).toBe(true);
    expect(bronzeMatch?.sideA).toMatchObject({
      sourceType: 'MATCH_LOSER',
      sourceMatchExternalId: '2026-08-01-0900-semi-final-1',
      sourceLabel: 'Loser of Semi-final 1',
    });
    expect(bronzeMatch?.sideB).toMatchObject({
      sourceType: 'MATCH_LOSER',
      sourceMatchExternalId: '2026-08-01-1300-semi-final-2',
      sourceLabel: 'Loser of Semi-final 2',
    });
    expect(goldMatch?.sideA).toMatchObject({
      sourceType: 'MATCH_WINNER',
      sourceMatchExternalId: '2026-08-01-0900-semi-final-1',
      sourceLabel: 'Winner of Semi-final 1',
    });
    expect(goldMatch?.sideB).toMatchObject({
      sourceType: 'MATCH_WINNER',
      sourceMatchExternalId: '2026-08-01-1300-semi-final-2',
      sourceLabel: 'Winner of Semi-final 2',
    });
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
    expect(playersWithPhotos.map((player) => player.photoUrl).sort()).toEqual([
      'https://upload.wikimedia.org/wikipedia/commons/3/34/England_Netball_player_Funmi_Fadoju.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/4/4b/Thunderbirds_shooter_Eleanor_Cardwell.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/6/6d/England_Netball_player_Olivia_Tchine.jpg',
    ]);
    expect(playersWithPhotos.every((player) => (
      player.photoSourceUrl
      && player.photoCredit
      && player.photoLicense === 'CC BY-SA 4.0'
      && player.photoVerifiedAt
    ))).toBe(true);
    expect(bundle.results).toEqual([]);
    expect(bundle.coverage.every((coverage) => coverage.state === 'UNAVAILABLE')).toBe(true);
  });

  it('allows only the narrow Wikimedia image host and Commons path used by the bundle', async () => {
    const { bundle } = await loadSourceBundle();
    const playersWithPhotos = bundle.players.filter((player) => player.photoUrl);
    const remotePatterns = nextConfig.images?.remotePatterns ?? [];

    expect(remotePatterns).toContainEqual({
      protocol: 'https',
      hostname: 'upload.wikimedia.org',
      pathname: '/wikipedia/commons/**',
    });
    expect(remotePatterns).not.toContainEqual(expect.objectContaining({ hostname: 'commons.wikimedia.org' }));
    expect(playersWithPhotos.every((player) => {
      const photoUrl = new URL(player.photoUrl!);
      return photoUrl.protocol === 'https:'
        && photoUrl.hostname === 'upload.wikimedia.org'
        && photoUrl.pathname.startsWith('/wikipedia/commons/');
    })).toBe(true);
  });
});
