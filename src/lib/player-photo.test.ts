import { describe, expect, it } from 'vitest';
import { secondaryPlayerPhotoUrl } from './player-photo';

describe('secondaryPlayerPhotoUrl', () => {
  it('keeps existing photos that have no reuse attribution requirement', () => {
    expect(secondaryPlayerPhotoUrl({ photoUrl: 'https://cdn.example.test/player.jpg' }))
      .toBe('https://cdn.example.test/player.jpg');
  });

  it('uses initials on secondary surfaces for attributed reusable photos', () => {
    expect(secondaryPlayerPhotoUrl({
      photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/player.jpg',
      photoSourceUrl: 'https://commons.wikimedia.org/wiki/File:Player.jpg',
      photoCredit: 'Example Photographer',
      photoLicense: 'CC BY-SA 4.0',
    })).toBeNull();
  });

  it('returns null when no photo exists', () => {
    expect(secondaryPlayerPhotoUrl({ photoUrl: null })).toBeNull();
  });
});
