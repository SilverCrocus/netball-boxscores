import { describe, expect, it } from 'vitest';
import { validImport } from '@/lib/sources/__tests__/fixtures';
import { validateNormalizedImport } from '@/lib/sources/validation';

describe('player photo source validation', () => {
  it('accepts a sourced and licensed player photo', () => {
    expect(validateNormalizedImport(validImport())).toEqual([]);
  });

  it('rejects a photo without a source page or licence', () => {
    const input = validImport();
    input.players[0].photoSourceUrl = undefined;
    input.players[0].photoLicense = undefined;

    expect(validateNormalizedImport(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_PHOTO_SOURCE' }),
      expect.objectContaining({ code: 'REQUIRED_FIELD', fieldPath: 'players.photoLicense' }),
    ]));
  });

  it('rejects non-HTTP photo locations and invalid verification dates', () => {
    const input = validImport();
    input.players[0].photoUrl = 'file:///tmp/player.jpg';
    input.players[0].photoVerifiedAt = 'not-a-date';

    expect(validateNormalizedImport(input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_URL', fieldPath: 'players.photoUrl' }),
      expect.objectContaining({ code: 'INVALID_DATETIME', fieldPath: 'players.photoVerifiedAt' }),
    ]));
  });
});
