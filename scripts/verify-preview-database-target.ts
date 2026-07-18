import { verifyPreviewDatabaseTarget } from './lib/preview-database-target';

const evidence = verifyPreviewDatabaseTarget();

// Ref-only evidence: never print URLs, usernames, passwords, or tokens.
console.log(JSON.stringify({
  status: 'verified-preview-database-target',
  ...evidence,
}, null, 2));
