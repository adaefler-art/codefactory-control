# AFU-9 v0.4 Repo Cleanup Report

## Workflows
- **Archived**
  - `.github/workflows/_archived/afu9-bugfix.yml` — Legacy v0.1 bugfix trigger; superseded by standard deploy flows.
  - `.github/workflows/_archived/main.yml` — One-off AFU-9 v0.3 roadmap issue importer; v0.4 tracking handled elsewhere.
  - `.github/workflows/_archived/import-v04-issues.yml` — One-time v0.4 issue importer; kept for audit only.
  - `.github/workflows/_archived/self-propelling-demo.yml` — Demo-only self-propelling issue flow; outside v0.4 scope.
- **Active**
  - `.github/workflows/build-determinism.yml` — PR/push check for deterministic Docker builds (control-center + MCP images).
  - `.github/workflows/deploy-cdk-stack.yml` — Manual CDK stack deploy with diff gate (infrastructure changes).
  - `.github/workflows/deploy-ecs.yml` — Staging auto-deploy on `main` and manual production deploy (app images + migrations gate).
  - `.github/workflows/health-check-contract.yml` — PR/push tests for health/ready contract and ALB path checks.
  - `.github/workflows/security-validation.yml` — PR/push IAM validation and optional policy change review comment.
  - `.github/workflows/sync-check.yml` — PR sync/merge-conflict guard plus basic builds for control plane/MCP servers.

## Docs
- Moved v0.4 import documentation to `docs/v04/`:
  - `README-V04-ISSUES.md`, `EXECUTION-INSTRUCTIONS.md`, `SUMMARY.md`, and new index `README.md`.
- Updated relative links to reference archived workflow location and shared docs under `docs/`.
- Data + scripts for v0.4 import remain in `scripts/` (source of truth for automation payloads).

## Inkonsistenzen
- **S2**: Deployment documentation is spread across multiple guides (`docs/DEPLOYMENT.md`, `docs/AWS_DEPLOY_RUNBOOK.md`, `docs/ECS-DEPLOYMENT.md`); consider a single entry point/index.
- **S3**: `build-determinism.yml` and `sync-check.yml` run heavyweight builds on PRs; may be slow for contributors.
- **S3**: No automated link-check currently run after doc moves; manual verification recommended.

## Empfohlene nächste Schritte
1. Add a short pointer in the root `README.md` to `docs/v04/README.md` as the v0.4 documentation hub.
2. Consider a scheduled or PR link-check job to catch broken Markdown links after doc moves.
3. Evaluate reducing scope or frequency of `sync-check.yml` (e.g., run on label or nightly) to shorten PR cycles.
4. Consolidate deployment/runbook entry points into a single index page to reduce reader confusion.
5. Keep `import-v04-issues` data under `scripts/` but add a note in that folder pointing to `docs/v04/` for the docs.
