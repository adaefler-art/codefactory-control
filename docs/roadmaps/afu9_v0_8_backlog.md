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

## EPIC E81 — INTENT Issue Authoring: AFU9 Issues vollständig per Chat erstellen

- I811 (E81.1): “Issue Draft” Schema v1 + Validator (Zod) + Examples (few-shot)

  - DependsOn: v0.7 done
  - Labels: v0.8,epic:E81,layer:B,intent,issues,schema,determinism
- I812 (E81.2): INTENT Tool `create_afu9_issue_draft` + `update_afu9_issue_draft` (session-bound, no user secrets)

  - DependsOn: I811
  - Labels: v0.8,epic:E81,layer:B,intent,tools,issues
- I813 (E81.3): INTENT UI: Issue Draft Panel (preview, validation errors, canonicalId, labels, deps)

  - DependsOn: I812
  - Labels: v0.8,epic:E81,layer:B,intent,ui
- I814 (E81.4): “Briefing → Issue Set” Generator (batch from a briefing doc)

  - DependsOn: I813
  - Labels: v0.8,epic:E81,layer:B,intent,batch,productivity
- I815 (E81.5): Evidence Pack für Issue Authoring (inputs, outputs, hashes, lawbookVersion)

  - DependsOn: I812
  - Labels: v0.8,epic:E81,layer:A,evidence,audit

---

## EPIC E82 — Batch Publish: AFU9 Issues gesammelt nach GitHub erstellen/aktualisieren
- I821 (E82.1): Tool `publish_issues_to_github_batch` (create-or-update per canonicalId; idempotent)
  - DependsOn: E81.1,E81.2
  - Labels: v0.8,epic:E82,layer:B,intent,github,batch,idempotency
- I822 (E82.2): Dry-run + Diff View (zeigt: create/update/skip + reason)
  - DependsOn: I821
  - Labels: v0.8,epic:E82,layer:B,intent,github,evidence
- I823 (E82.3): Publish Audit Log + Backlinks (AFU9 Issue ↔ GitHub Issue)
  - DependsOn: I821
  - Labels: v0.8,epic:E82,layer:A,audit,memory,github
- I824 (E82.4): GH Rate-limit & Retry Policy (deterministic backoff, bounded)
  - DependsOn: I821
  - Labels: v0.8,epic:E82,layer:A,github,robustness

---

## EPIC E83 — GH Workflow Orchestrator: Copilot zuweisen → Output einsammeln → Review → Merge

- I831 (E83.1): Repo/Issue Actions Registry (was ist automatisierbar? labels, assignees, checks, merge rules)

  - DependsOn: I821
  - Labels: v0.8,epic:E83,layer:A,github,policy
- I832 (E83.2): Tool `assign_copilot_to_issue` (oder äquivalentes GH Assignment Pattern) + Evidence

  - DependsOn: I831
  - Labels: v0.8,epic:E83,layer:C,github,automation
- I833 (E83.3): Tool `collect_copilot_output` / “Implementation Summary Ingestion” (PR desc, comments, artifacts)

  - DependsOn: I832
  - Labels: v0.8,epic:E83,layer:A,memory,evidence
- I834 (E83.4): Tool `request_review_and_wait_checks` (poll checks, bounded intervals, status rollup)

  - DependsOn: I833
  - Labels: v0.8,epic:E83,layer:C,checks,automation
- I835 (E83.5): Merge Gate: `merge_pr_with_approval` + branch cleanup (explicit user approval required)

  - DependsOn: I834
  - Labels: v0.8,epic:E83,layer:C,merge,guardrails,approval

---

## EPIC E84 — Failed Checks Debug Loop: automatisiert triage → Copilot prompt → Re-run
- I841 (E84.1): "Checks Triage" Analyzer (klassifiziert: lint/test/build/e2e/infra; extracts failing logs)
  - DependsOn: I834
  - Labels: v0.8,epic:E84,layer:C,debug,evidence
- I842 (E84.2): Deterministischer Copilot Prompt Generator (per failure-class; minimal diff; acceptance criteria)
  - DependsOn: I841
  - Labels: v0.8,epic:E84,layer:C,copilot,debug
- I843 (E84.3): Tool `rerun_failed_jobs` + bounded retry policy + audit
  - DependsOn: I841
  - Labels: v0.8,epic:E84,layer:C,github,automation
- I844 (E84.4): "Stop Conditions" + HOLD Rules (lawbook-gated; avoids infinite loops)
  - DependsOn: I843
  - Labels: v0.8,epic:E84,layer:C,guardrails,lawbook

---

## EPIC E85 — Issue State Flow v2: Steuerung & Sync AFU9 ↔ GitHub
- I851 (E85.1): Canonical State Machine Spec (AFU9 status ↔ GH labels/state ↔ checks/merge)
  - DependsOn: v0.7 done
  - Labels: v0.8,epic:E85,layer:A,state-model,determinism
- I852 (E85.2): Bi-directional Sync (AFU9→GH: labels/status; GH→AFU9: open/closed, review, checks)
  - DependsOn: I851
  - Labels: v0.8,epic:E85,layer:A,github,sync,idempotency
- I853 (E85.3): UI: State Flow Viewer (zeigt "was fehlt bis DONE", next action button)
  - DependsOn: I852
  - Labels: v0.8,epic:E85,layer:B,ui,issues
- I854 (E85.4): Drift Detection + Repair Suggestions (evidence-first; no auto destructive changes)
  - DependsOn: I852
  - Labels: v0.8,epic:E85,layer:A,drift,evidence

---

## EPIC E86 — Transparency: MCP Tools & Integrations Stand sichtbar machen
- I861 (E86.1): "Tools Catalog" Page (alle MCP server + tools + version + health + lastUsed)
  - DependsOn: v0.7 done
  - Labels: v0.8,epic:E86,layer:B,ui,observability,tools
- I862 (E86.2): Capability Manifest Endpoint (what INTENT can do; derived from registry, deterministic)
  - DependsOn: I861
  - Labels: v0.8,epic:E86,layer:A,intent,tools
- I863 (E86.3): Integration Readiness Checklist (GitHub App, Actions, OIDC role, env vars) + self-test
  - DependsOn: I861
  - Labels: v0.8,epic:E86,layer:A,ops,diagnostics

---

## EPIC E87 — Guardrails & Approvals für Automation (Lawbook-bound)
- I871 (E87.1): Approval Gate Framework (UI prompt + signed "yes" for merge/prod/destructive ops)
  - DependsOn: E83.5
  - Labels: v0.8,epic:E87,layer:C,guardrails,approval
- I872 (E87.2): Lawbook Mapping für Automation Steps (allowed actions, cooldowns, maxRuns, idempotencyKey rules)
  - DependsOn: v0.7 guardrail gates
  - Labels: v0.8,epic:E87,layer:A,lawbook,guardrails
- I873 (E87.3): Audit Trail Unification (issue actions, merges, reruns, approvals → timeline)
  - DependsOn: I823,I835,I843
  - Labels: v0.8,epic:E87,layer:A,audit,memory

---

## EPIC E88 — Outcome Metrics: HSH reduzieren (manuelle Stunden) messbar machen
- I881 (E88.1): "Manual Touchpoints" Counter (per cycle: assign/review/merge/debug) + baseline capture
  - DependsOn: E83
  - Labels: v0.8,epic:E88,layer:A,metrics,velocity
- I882 (E88.2): Automation KPI Dashboard (D2D/HSH/DCU + "Automation Coverage %")
  - DependsOn: I881
  - Labels: v0.8,epic:E88,layer:B,ui,kpi
- I883 (E88.3): Weekly Report Export (JSON/MD) for release evidence
  - DependsOn: I882
  - Labels: v0.8,epic:E88,layer:A,evidence,reporting

