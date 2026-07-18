import 'server-only';

import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { GLASGOW_2026_IDENTITY } from '@/lib/edition-publication-readiness';

export const GLASGOW_DRAFT_PREVIEW_PATH = '/admin/preview/glasgow-2026';
export const GLASGOW_DRAFT_PREVIEW_SIGN_IN =
  `/auth/signin?callbackUrl=${encodeURIComponent(GLASGOW_DRAFT_PREVIEW_PATH)}`;

const EDITION_AUDIT_ID =
  `${GLASGOW_2026_IDENTITY.competitionSlug}/${GLASGOW_2026_IDENTITY.editionSlug}`;
const STABLE_USER_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/;
const DEPLOYED_COMMIT = /^[a-f0-9]{7,64}$/i;

export type DraftPreviewAuditOutcome =
  | 'DISABLED'
  | 'MALFORMED_CONFIGURATION'
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'AUTHORIZED'
  | 'EDITION_NOT_FOUND'
  | 'RENDERED';

export interface DraftPreviewAuditRecord {
  userId: string | null;
  editionId: string;
  outcome: DraftPreviewAuditOutcome;
  timestamp: string;
  deployedCommit: string | null;
}

interface DraftPreviewAccessDependencies {
  env?: DraftPreviewEnvironment;
  getSession?: () => Promise<{ user?: { id?: string | null } | null } | null>;
  deny?: () => never;
  redirectTo?: (destination: string) => never;
  audit?: (record: DraftPreviewAuditRecord) => void;
  now?: () => Date;
}

type DraftPreviewConfiguration =
  | { state: 'disabled' }
  | { state: 'malformed' }
  | { state: 'enabled'; operatorIds: ReadonlySet<string> };

type DraftPreviewEnvironment = Readonly<Record<string, string | undefined>>;

export function readDraftPreviewConfiguration(
  env: DraftPreviewEnvironment = process.env,
): DraftPreviewConfiguration {
  const enabled = env.DRAFT_PREVIEW_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return { state: 'disabled' };
  }
  if (enabled !== 'true') return { state: 'malformed' };

  const rawOperatorIds = env.DRAFT_PREVIEW_OPERATOR_IDS;
  if (!rawOperatorIds) return { state: 'malformed' };

  const operatorIds = rawOperatorIds.split(',').map((value) => value.trim());
  if (
    operatorIds.length === 0
    || operatorIds.some((value) => !STABLE_USER_ID.test(value))
  ) {
    return { state: 'malformed' };
  }

  return { state: 'enabled', operatorIds: new Set(operatorIds) };
}

function deployedCommit(env: DraftPreviewEnvironment): string | null {
  const value = env.RENDER_GIT_COMMIT?.trim();
  return value && DEPLOYED_COMMIT.test(value) ? value : null;
}

export function writeDraftPreviewAudit(
  outcome: DraftPreviewAuditOutcome,
  userId: string | null,
  options: Pick<DraftPreviewAccessDependencies, 'env' | 'audit' | 'now'> = {},
): void {
  const env = options.env ?? process.env;
  const record: DraftPreviewAuditRecord = {
    userId,
    editionId: EDITION_AUDIT_ID,
    outcome,
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    deployedCommit: deployedCommit(env),
  };

  (options.audit ?? ((entry) => console.info('[DraftPreviewAudit]', JSON.stringify(entry))))(record);
}

export async function requireGlasgowDraftPreviewAccess(
  dependencies: DraftPreviewAccessDependencies = {},
): Promise<{ userId: string }> {
  const env = dependencies.env ?? process.env;
  const deny = dependencies.deny ?? notFound;
  const redirectTo = dependencies.redirectTo ?? redirect;
  const auditOptions = {
    env,
    audit: dependencies.audit,
    now: dependencies.now,
  };
  const configuration = readDraftPreviewConfiguration(env);

  if (configuration.state !== 'enabled') {
    writeDraftPreviewAudit(
      configuration.state === 'disabled' ? 'DISABLED' : 'MALFORMED_CONFIGURATION',
      null,
      auditOptions,
    );
    return deny();
  }

  const session = await (dependencies.getSession
    ?? (() => getServerSession(authOptions)))();
  const userId = session?.user?.id;
  if (!userId || !STABLE_USER_ID.test(userId)) {
    writeDraftPreviewAudit('UNAUTHENTICATED', null, auditOptions);
    return redirectTo(GLASGOW_DRAFT_PREVIEW_SIGN_IN);
  }

  if (!configuration.operatorIds.has(userId)) {
    writeDraftPreviewAudit('UNAUTHORIZED', userId, auditOptions);
    return deny();
  }

  writeDraftPreviewAudit('AUTHORIZED', userId, auditOptions);
  return { userId };
}
