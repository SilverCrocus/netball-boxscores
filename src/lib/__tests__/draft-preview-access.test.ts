import { describe, expect, it, vi } from 'vitest';
import {
  GLASGOW_DRAFT_PREVIEW_SIGN_IN,
  readDraftPreviewConfiguration,
  requireGlasgowDraftPreviewAccess,
} from '@/lib/draft-preview-access';

const NOW = new Date('2026-07-17T04:00:00.000Z');

function deny(): never {
  throw new Error('NOT_FOUND');
}

function redirectTo(destination: string): never {
  throw new Error(`REDIRECT:${destination}`);
}

describe('Glasgow DRAFT preview access', () => {
  it.each([
    [{}, 'disabled'],
    [{ DRAFT_PREVIEW_ENABLED: 'false' }, 'disabled'],
    [{ DRAFT_PREVIEW_ENABLED: 'TRUE', DRAFT_PREVIEW_OPERATOR_IDS: 'operator-1' }, 'malformed'],
    [{ DRAFT_PREVIEW_ENABLED: 'true' }, 'malformed'],
    [{ DRAFT_PREVIEW_ENABLED: 'true', DRAFT_PREVIEW_OPERATOR_IDS: 'operator-1,,operator-2' }, 'malformed'],
    [{ DRAFT_PREVIEW_ENABLED: 'true', DRAFT_PREVIEW_OPERATOR_IDS: 'operator 1' }, 'malformed'],
  ])('fails closed for configuration %j', (env, state) => {
    expect(readDraftPreviewConfiguration(env)).toMatchObject({ state });
  });

  it('does not create a session or run loaders when the feature is disabled', async () => {
    const getSession = vi.fn();
    const audit = vi.fn();

    await expect(requireGlasgowDraftPreviewAccess({
      env: {},
      getSession,
      deny,
      redirectTo,
      audit,
      now: () => NOW,
    })).rejects.toThrow('NOT_FOUND');

    expect(getSession).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'DISABLED', userId: null }));
  });

  it('redirects an unauthenticated request to the fixed sign-in callback', async () => {
    const audit = vi.fn();
    await expect(requireGlasgowDraftPreviewAccess({
      env: {
        DRAFT_PREVIEW_ENABLED: 'true',
        DRAFT_PREVIEW_OPERATOR_IDS: 'operator-1',
      },
      getSession: async () => null,
      deny,
      redirectTo,
      audit,
      now: () => NOW,
    })).rejects.toThrow(`REDIRECT:${GLASGOW_DRAFT_PREVIEW_SIGN_IN}`);

    expect(GLASGOW_DRAFT_PREVIEW_SIGN_IN).toBe(
      '/auth/signin?callbackUrl=%2Fadmin%2Fpreview%2Fglasgow-2026',
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'UNAUTHENTICATED' }));
  });

  it('returns 404 for an authenticated user outside the allowlist', async () => {
    const audit = vi.fn();
    await expect(requireGlasgowDraftPreviewAccess({
      env: {
        DRAFT_PREVIEW_ENABLED: 'true',
        DRAFT_PREVIEW_OPERATOR_IDS: 'operator-1',
        RENDER_GIT_COMMIT: '57276846332306a0a7d5b574f3f1fb0fb4cc4277',
      },
      getSession: async () => ({ user: { id: 'ordinary-user' } }),
      deny,
      redirectTo,
      audit,
      now: () => NOW,
    })).rejects.toThrow('NOT_FOUND');

    expect(audit).toHaveBeenCalledWith({
      userId: 'ordinary-user',
      editionId: 'commonwealth-games-netball/glasgow-2026',
      outcome: 'UNAUTHORIZED',
      timestamp: NOW.toISOString(),
      deployedCommit: '57276846332306a0a7d5b574f3f1fb0fb4cc4277',
    });
  });

  it('allows a stable allowlisted session user ID and audits only safe fields', async () => {
    const audit = vi.fn();
    await expect(requireGlasgowDraftPreviewAccess({
      env: {
        DRAFT_PREVIEW_ENABLED: 'true',
        DRAFT_PREVIEW_OPERATOR_IDS: 'operator-1, operator-2',
        RENDER_GIT_COMMIT: 'not-a-commit secret-value',
        DATABASE_URL: 'must-not-leak',
      },
      getSession: async () => ({ user: { id: 'operator-2' } }),
      deny,
      redirectTo,
      audit,
      now: () => NOW,
    })).resolves.toEqual({ userId: 'operator-2' });

    expect(audit).toHaveBeenCalledWith({
      userId: 'operator-2',
      editionId: 'commonwealth-games-netball/glasgow-2026',
      outcome: 'AUTHORIZED',
      timestamp: NOW.toISOString(),
      deployedCommit: null,
    });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('must-not-leak');
  });
});
