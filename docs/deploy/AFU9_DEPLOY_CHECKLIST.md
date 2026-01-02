Usage

This prompt MUST be:

applied as Copilot Workspace/System Prompt

referenced in deploy workflows

used by all AFU-9 internal agents

Non-compliance is considered a deployment governance violation.


---

## 📄 `docs/deploy/AFU9_DEPLOY_CHECKLIST.md`

```md
# AFU-9 Deploy Checklist (v1 – Canonical)

This checklist MUST be completed before any deploy.
It exists to prevent recurring, expensive deployment failures.

---

## A. Intent

- [ ] What is being deployed? → app | infra
- [ ] Why now? → bugfix | feature | rollout
- [ ] DEPLOY_ENV → staging | production
- [ ] Expected effect → no-infra-change | infra-additive

---

## B. Environment Invariants

- [ ] ECS cluster is correct (afu9-cluster)
- [ ] ECS service is correct (afu9-control-center / -staging)
- [ ] No implicit env switching
- [ ] Staging service existence matches intent
- [ ] Multi-env deploys: `-c afu9-multi-env=true` and staging-only deploy uses `Afu9EcsStageStack` (not `Afu9EcsProdStack`)

---

## C. Secrets & Configuration

- [ ] Database secret used: **afu9/database** (NOT master)
- [ ] Secret keys present:
  - host
  - port
  - database
  - username
  - password
- [ ] Secrets are injected via ECS (no runtime GetSecretValue)
- [ ] Staging smoke bypass key uses secret name `afu9/stage/smoke-key` (no suffix-pinned ARN) and is never present in prod task defs

## C1. MCP Sidecars

- [ ] If runner is enabled: image `afu9/mcp-runner:${TAG_PREFIX}-...` is built/pushed and task definition references the correct env tag

---

## D. DNS & Routing

- [ ] MANAGE_DNS explicitly set
- [ ] Route53 changes expected? → yes | no
- [ ] Existing records will not be replaced unintentionally

---

## E. Preflight

- [ ] preflight.sh exit code = 0
- [ ] ECS cluster ACTIVE
- [ ] Required services exist
- [ ] DNS conflicts handled or skipped intentionally

---

## F. CDK Diff Gate

- [ ] NO ECS::Cluster deletion
- [ ] NO IAM::Role replacement
- [ ] NO Listener or Route53 deletion
- [ ] Only additive changes (if any)

---

## G. Go / No-Go

- [ ] Diff fully understood
- [ ] Rollback path known
- [ ] Deploy approved

---

This checklist is intentionally boring.
Boredom means stability.