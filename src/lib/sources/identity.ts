import type { SourceEntityType } from '@prisma/client';

export function sourceIdentityKey(input: {
  sourceKey: string;
  editionExternalId: string;
  entityType: SourceEntityType;
  externalId: string;
}): string {
  return [
    input.sourceKey.trim().toLowerCase(),
    input.editionExternalId.trim(),
    input.entityType,
    input.externalId.trim(),
  ].join(':');
}
