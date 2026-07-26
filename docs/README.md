# CentrePass documentation

This directory contains the current architecture, performance policy, release
evidence templates, and operational runbooks for CentrePass.

Last full documentation audit: **2026-07-24**. Runtime behavior was verified
against `main@da2f523e23dcaf89a56976fbc7dc5591963d3226`; the navigation regression
monitor was introduced alongside this audit.

## Start here

- [Architecture](architecture.md) — current runtime, domain model, data flow,
  route groups, security boundaries, and sources of truth.
- [Performance](performance.md) — implemented performance work, accepted and
  pending evidence, automated monitoring, budgets, and the next decision gates.
- [Project README](../README.md) — local setup, safe development defaults, and
  everyday commands.

## Current operational documents

| Area | Document | Purpose |
| --- | --- | --- |
| Release | [Production release](runbooks/production-release.md) | Governed preflight, deployment, feature enablement, publication, and verification |
| Release | [Production readiness evidence](releases/production-readiness-template.md) | Per-release evidence template |
| Environment | [Production environment](runbooks/production-environment.md) | Render, Supabase, feature-flag, role, and secret contracts |
| Database | [Analytics roles](runbooks/analytics-readonly-role.md) | Least-privilege analytics and operations database roles |
| Verification | [Production smoke](runbooks/production-smoke.md) | Automated and browser QA |
| Monitoring | [Production monitoring](runbooks/production-monitoring.md) | Post-deploy and incident observation |
| Performance | [Live measurement](runbooks/live-performance-measurement.md) | Server/data timing capture and interpretation |
| Performance | [Navigation monitoring](runbooks/navigation-performance-monitoring.md) | Scheduled browser regression monitor |
| Recovery | [Production rollback](runbooks/production-rollback.md) | Application and feature containment |
| Glasgow | [Source provenance](runbooks/glasgow-2026-source-provenance.md) | Source and receipt evidence |
| Glasgow | [Launch](runbooks/glasgow-2026-launch.md) | Governed DRAFT-to-PUBLISHED flow |
| Glasgow | [Results](runbooks/glasgow-2026-results.md) | Manual published-results imports |
| Glasgow | [Correction](runbooks/glasgow-2026-compensating-correction.md) | Immutable compensating corrections |
| Glasgow | [Rollback](runbooks/glasgow-2026-rollback.md) | Data-preserving emergency unpublish |

The correction JSON template is
[`runbooks/templates/glasgow-2026-results-correction.json`](runbooks/templates/glasgow-2026-results-correction.json).
The Glasgow flag asset licence and provenance live beside the assets in
[`public/flags/glasgow-2026/README.md`](../public/flags/glasgow-2026/README.md).

## Historical evidence

Files under [`history/`](history/) are immutable point-in-time evidence, not
current operating instructions:

- [2026-07-17 Wave 2 audit](history/2026-07-17-wave2-security-ci-performance-audit.md)
- [2026-07-22 Render preview migration incident](history/2026-07-22-render-preview-migration-incident.md)

Never use a historical commit, service ID, metric, approval, or test result as
current evidence without verifying it again.

## Documentation lifecycle

- The code, Prisma migrations, `render.yaml`, workflow files, and runtime
  health/readiness responses are authoritative when prose and implementation
  disagree.
- Operational runbooks must describe commands that exist in `package.json` and
  must preserve production approval, target, and evidence boundaries.
- One-off plans and completed implementation specifications do not stay in the
  active tree. Git history retains them.
- A historical incident or audit is kept only when it explains a durable
  control or release-ledger fact. It must be labelled as historical.
- New roadmap items belong in [performance.md](performance.md) or an issue, not
  in an undated root-level todo file.
- After changing code or documentation, validate internal links and documented
  commands, then refresh Graphify. Generated `graphify-out/` changes are not
  included in feature branches unless explicitly required.
