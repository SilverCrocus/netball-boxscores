import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedCompetitionImport } from '@/lib/sources/types';
import { loadGlasgowFoundationSourceEvidence } from '@/lib/glasgow/source-manifest';
import nextConfig from '../../../next.config';

const bundlePath = path.resolve('data/glasgow-2026/v1/bundle.json');
const manifestPath = path.resolve('data/glasgow-2026/v1/source-manifest.json');

async function loadSourceBundle() {
  const bundleText = await readFile(bundlePath, 'utf8');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    bundleFileSha256: string;
    sources: Array<{
      id: string;
      url: string;
      purpose: string;
      retrievedAt: string;
      fetchStatus: string;
    }>;
    declarations: {
      publicationStatusPolicy: string;
      publicationBlockers: string[];
      matchCoverage: { unresolvedSlots: number; dependentSlots: number };
      squadIdentityCoverage: {
        finalSquads: number;
        provisionalSquads: number;
        importedCompleteSquads: number;
      };
      squadCoverage: Record<string, {
        identity: string;
        positions: string;
        importedPlayers: number;
      }>;
      squadMembers: Record<string, {
        status: string;
        members: Array<string | { name: string; position: string; isCaptain: boolean }>;
      }>;
      photoCoverage: { verifiedReusablePhotos: number };
      factualDataReuse: {
        basis: string;
        organiserApproval: string;
      };
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
    expect(manifest.declarations.publicationStatusPolicy).toBe('DRAFT_ONLY');
    expect(manifest.declarations.publicationBlockers).toEqual([]);
  });

  it('derives publication expectations and compact receipt provenance from the audited sidecar', async () => {
    const evidence = await loadGlasgowFoundationSourceEvidence(bundlePath);

    expect(evidence.expectedImportChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.receiptMetadata).toMatchObject({
      importKind: 'GLASGOW_FOUNDATION',
      sourceManifest: expect.objectContaining({
        bundleVersion: 'v1',
        publicationStatusPolicy: 'DRAFT_ONLY',
        sourceCount: expect.any(Number),
      }),
    });
    expect(evidence.publicationExpectation).toMatchObject({
      importChecksum: evidence.expectedImportChecksum,
      teamExternalIds: expect.arrayContaining(['AUS', 'NZL']),
      canonicalPlayers: expect.arrayContaining([
        expect.objectContaining({ externalId: 'JAM-shamera-sterling-humphrey' }),
      ]),
    });
    expect(evidence.publicationExpectation.teamExternalIds).toHaveLength(12);
    expect(evidence.publicationExpectation.playerExternalIds).toHaveLength(96);
    expect(evidence.publicationExpectation.matchExternalIds).toHaveLength(38);
    expect(evidence.publicationExpectation.canonicalPlayers).toHaveLength(23);
    expect(evidence.publicationExpectation.editionCoverage).toHaveLength(10);
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

  it('imports complete position-supported squads and retains audited evidence for every other team', async () => {
    const { bundle, manifest } = await loadSourceBundle();
    const playerCounts = Object.groupBy(bundle.players, (player) => player.teamExternalId);
    const playersWithPhotos = bundle.players.filter((player) => player.photoUrl);
    const canonicalPlayers = bundle.players.filter(
      (player) => player.canonicalChampionDataPlayerId !== undefined,
    );

    expect(bundle.players).toHaveLength(96);
    expect(bundle.rosters).toHaveLength(96);
    expect(Object.keys(playerCounts).sort()).toEqual([
      'AUS', 'ENG', 'JAM', 'NIR', 'NZL', 'RSA', 'SCO', 'WAL',
    ]);
    expect(Object.values(playerCounts).every((players) => players?.length === 12)).toBe(true);
    expect(canonicalPlayers).toHaveLength(23);
    expect(new Set(
      canonicalPlayers.map((player) => player.canonicalChampionDataPlayerId),
    ).size).toBe(canonicalPlayers.length);
    expect(canonicalPlayers).toContainEqual(expect.objectContaining({
      externalId: 'JAM-shamera-sterling-humphrey',
      canonicalChampionDataPlayerId: 80830,
    }));
    expect(manifest.declarations.squadIdentityCoverage).toEqual({
      finalSquads: 11,
      provisionalSquads: 1,
      importedCompleteSquads: 8,
    });
    expect(manifest.declarations.squadCoverage.UGA).toMatchObject({
      identity: 'PROVISIONAL',
      importedPlayers: 0,
    });
    expect(manifest.declarations.squadMembers.MWI).toMatchObject({ status: 'FINAL' });
    expect(manifest.declarations.squadMembers.MWI.members).toHaveLength(12);
    expect(manifest.declarations.squadMembers.TON.members).toHaveLength(12);
    expect(manifest.declarations.squadMembers.TTO.members).toHaveLength(12);
    expect(manifest.declarations.squadMembers.UGA).toMatchObject({ status: 'PROVISIONAL' });
    expect(manifest.declarations.squadMembers.UGA.members).toHaveLength(15);
    expect(bundle.players.some((player) => player.teamExternalId === 'UGA')).toBe(false);
    expect(bundle.players.some((player) => player.name === 'Sophilet Banda')).toBe(false);
    expect(bundle.players).toContainEqual(expect.objectContaining({
      externalId: 'WAL-phillipa-yarranton',
      name: 'Phillipa Yarranton',
    }));
    expect(bundle.players.some((player) => player.name === 'Philippa Yarranton')).toBe(false);
    expect(bundle.rosters).toContainEqual(expect.objectContaining({
      playerExternalId: 'WAL-phillipa-yarranton',
    }));
    expect(bundle.players).toContainEqual(expect.objectContaining({
      externalId: 'NIR-lauren-walshe',
      name: 'Lauren Walshe',
      position: 'GK',
    }));
    expect(bundle.rosters).toContainEqual(expect.objectContaining({
      playerExternalId: 'NIR-michelle-magee',
      isCaptain: true,
    }));
    expect(bundle.rosters).toContainEqual(expect.objectContaining({
      playerExternalId: 'JAM-shamera-sterling-humphrey',
      isCaptain: true,
    }));
    expect(playersWithPhotos).toHaveLength(4);
    expect(playersWithPhotos).toHaveLength(manifest.declarations.photoCoverage.verifiedReusablePhotos);
    expect(playersWithPhotos.map((player) => player.photoUrl).sort()).toEqual([
      'https://upload.wikimedia.org/wikipedia/commons/3/34/England_Netball_player_Funmi_Fadoju.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/4/4b/Thunderbirds_shooter_Eleanor_Cardwell.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/6/6d/England_Netball_player_Olivia_Tchine.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/d/d4/Thunderbirds_defender_Shamera_Sterling.jpg',
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

  it('keeps a complete, deterministic provenance ledger for squads and photos', async () => {
    const { bundle, manifest } = await loadSourceBundle();
    const sourceIds = manifest.sources.map((source) => source.id);
    const photoSources = new Set(
      bundle.players.flatMap((player) => player.photoSourceUrl ? [player.photoSourceUrl] : [])
    );

    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    expect(manifest.sources.every((source) => (
      source.url.startsWith('https://')
      && source.purpose.length > 0
      && source.fetchStatus === 'REFERENCED'
      && !Number.isNaN(Date.parse(source.retrievedAt))
    ))).toBe(true);
    expect(manifest.sources.some((source) => source.fetchStatus === 'VERIFIED')).toBe(false);
    expect(manifest.declarations.factualDataReuse).toEqual({
      basis: 'PUBLIC_FACTUAL_DATA_USER_ASSERTED',
      organiserApproval: 'NOT_CLAIMED',
    });
    expect(sourceIds).toEqual(expect.arrayContaining([
      'australia-squad',
      'south-africa-squad',
      'northern-ireland-squad',
      'malawi-squad-post',
      'tonga-squad-post',
      'jamaica-squad-post',
      'trinidad-tobago-squad-post',
      'uganda-provisional-squad',
    ]));
    expect(new Set(
      manifest.sources
        .filter((source) => source.id.endsWith('-photo'))
        .map((source) => source.url)
    )).toEqual(photoSources);
  });
});
