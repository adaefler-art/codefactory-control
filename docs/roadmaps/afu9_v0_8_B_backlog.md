# AFU-9 Backlog v0.8 (Import) — Focus: Reduktion manueller Aufwände

## META

* Release: v0.8
* Preconditions (must be DONE before any v0.8 work):

  * v0.7 Ops DB Status-Korrektur: Issues in AFU9 auf DONE setzen (via PR #655 /ops/db/issues) und evidence loggen
* Scope Principle: **Automation of the “monotone GH loop”** + **INTENT als Issue-Authoring + Batch Publisher**
* Out of scope (v0.9+): Full autonomous PR autogen ohne Human Approval; destructive infra ops; prod enablement changes
* Non-Negotiables:

  * GitHub Auth: GitHub App server-to-server (JWT → Installation Token), no OAuth
  * Determinism/Evidence: every step produces evidence; no trial-and-error without logs
  * Idempotency everywhere (create/update/publish/dispatch/merge)
  * Guardrails transparent + versioned; lawbookVersion included in all artifacts
  * PowerShell for CLI snippets; default Copilot prompts for build/debug/impl
  * Human-in-the-loop: **Approval Gates** for merge / prod / destructive actions

---

## EPIC E89 — INTENT: Repo Evidence + Draft→GitHub Batch + Tool/Integration Transparenz
- I891 (E89.1): Repo Read-Only Policy (Allowlist owner/repo/branch) + GitHub-App Auth Wrapper (server-to-server)
  - DependsOn: E81.2
  - Labels: v0.8,epic:E89,layer:A,intent,evidence,security,github-app
- I892 (E89.2): Evidence Tool "listTree" (branch/path, pagination, deterministic ordering + result-hash)
  - DependsOn: I891
  - Labels: v0.8,epic:E89,layer:A,intent,evidence,github-app
- I893 (E89.3): Evidence Tool "readFile" (line ranges + snippet-hash, size limits, bounded output)
  - DependsOn: I891
  - Labels: v0.8,epic:E89,layer:A,intent,evidence,github-app
- I894 (E89.4): Evidence Tool "searchCode" (query constraints, rate-limit handling, deterministic ordering + result-hash)
  - DependsOn: I891
  - Labels: v0.8,epic:E89,layer:A,intent,evidence,github-app
- I895 (E89.5): INTENT "Sources" Integration (used_sources contract: file refs/issue refs/hashes) + UI Sources Panel wiring
  - DependsOn: I892,I893,I894
  - Labels: v0.8,epic:E89,layer:B,intent,ui,evidence
- I896 (E89.6): IssueDraft Version → GitHub Issues Batch Publish (create-or-update via canonicalId, bounded batch, idempotent)
  - DependsOn: E81.2
  - Labels: v0.8,epic:E89,layer:B,intent,github,automation,idempotency
- I897 (E89.7): Publish Audit Trail (DB table + session-scoped UI view; append-only, bounded result_json)
  - DependsOn: I896
  - Labels: v0.8,epic:E89,layer:A,audit,evidence,db,ui
- I898 (E89.8): Capabilities Registry + "Tools" UI (list all MCP/tools, enabled/disabled, last probe, versioned manifest)
  - DependsOn: I896
  - Labels: v0.8,epic:E89,layer:B,ui,observability,intent,mcp
- I899 (E89.9): Staging Smoke Runbook "Draft→Validate→Commit→Batch Publish→Verify" (PowerShell, evidence hashes/requestIds)
  - DependsOn: I896,I897,I898
  - Labels: v0.8,epic:E89,layer:A,docs,runbook,evidence

