# AFU-9 Backlog v0.7.1 (Import)

## META

* Release: v0.7.1
* Gate (must be DONE before any v0.7.1 work):

* Scope Principle (v0.7.1):

  * Stabilization + “Visibility/Transparency” + Issue State Flow v1 (Drift Resolution) + Stage-only Ops
* Out of scope (v0.8+):

  * Full Steering Loop Ausbau (Long-running Tasks), Issue→PR Automation / PR Autogen, breite Tool-Explosion
* Non-Negotiables:

  * GitHub Auth: GitHub App server-to-server (JWT → Installation Token), no OAuth
  * Determinism/Evidence: every step produces evidence; no trial-and-error without logs
  * Idempotency everywhere (dispatch, issue create/update, remediation)
  * Lawbook/Guardrails transparent + versioned; lawbookVersion included in all artifacts
  * PowerShell for CLI snippets; default Copilot prompts for build/debug/impl

---

## EPIC E81 — Issues v0.7.1: State Flow v1 + Drift Resolution

* I811 (E81.1): State Machine Contract (allowed transitions + error semantics; fail-closed)

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E81,issues,state-machine,api,security
* I812 (E81.2): Backend Enforce Transitions (PATCH status) + Audit + Timeline Event

  * DependsOn: I811
  * Labels: v0.7.1,epic:E81,issues,api,audit,timeline
* I813 (E81.3): Drift Detection Rules (GH vs Local) + “Resolve Drift” Options (DONE/KILLED + reason)

  * DependsOn: I811
  * Labels: v0.7.1,epic:E81,issues,drift,logic
* I814 (E81.4): UI “Resolve Drift” CTA/Modal (minimal diff) + post-action refresh

  * DependsOn: I812,I813
  * Labels: v0.7.1,epic:E81,issues,ui,ux
* I815 (E81.5): Tests: transition matrix + drift resolution + status codes (409/422) + idempotency

  * DependsOn: I812,I813
  * Labels: v0.7.1,epic:E81,tests,determinism

---

## EPIC E82 — GitHub Steering (Read-only) v0.7.1: Sync “Now” + Snapshot + Suggestions

* I821 (E82.1): “Sync now” (read-only refresh) on Issue Detail + lastSyncedAt

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E82,github,issues,sync,ui
* I822 (E82.2): Bounded Raw Snapshot Viewer (size limits, hash) + deterministic formatting

  * DependsOn: I821
  * Labels: v0.7.1,epic:E82,github,observability,determinism
* I823 (E82.3): Suggestion Engine v1 (e.g., GH=CLOSED → recommend DONE/KILLED locally) (no GH writes)

  * DependsOn: I821
  * Labels: v0.7.1,epic:E82,github,issues,drift
* I824 (E82.4): Tests + Runbook: stage smoke for sync/snapshot/suggestions

  * DependsOn: I821,I822,I823
  * Labels: v0.7.1,epic:E82,tests,runbook

---

## EPIC E83 — INTENT v0.7.1: UX Stabilization + Status Banner + Smoke-Probe

* I831 (E83.1): Fix Session UX Regression (“Session ID required” loop) end-to-end

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E83,intent,ux,reliability
* I832 (E83.2): /api/intent/status hardening (mode enum + Cache-Control:no-store) + UI banner/badge

  * DependsOn: I831
  * Labels: v0.7.1,epic:E83,intent,api,security
* I833 (E83.3): INTENT smoke runbook (stage) incl. disabled/enabled scenarios + troubleshooting

  * DependsOn: I832
  * Labels: v0.7.1,epic:E83,intent,runbook

---

## EPIC E84 — Packs/Memory v0.7.1: Sichtbarkeit + Verständlichkeit (ohne v0.8 Ausbau)

* I841 (E84.1): Packs UI Panel: list/view/export + short “What is a Pack?” explanation

  * DependsOn: I831
  * Labels: v0.7.1,epic:E84,intent,packs,ux
* I842 (E84.2): Packs API bounds + deterministic ordering + empty-state semantics

  * DependsOn: I841
  * Labels: v0.7.1,epic:E84,intent,api,determinism
* I843 (E84.3): Docs: Packs vs Product Memory vs Timeline (v0.7.1 clarification doc)

  * DependsOn: I841
  * Labels: v0.7.1,epic:E84,docs,concepts

---

## EPIC E85 — Incidents MVP v0.7.1: Nicht-leer + minimal nutzbar

* I851 (E85.1): Incidents List + Empty State + deterministic ordering

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E85,incidents,ui
* I852 (E85.2): Create Incident (minimal schema) + RBAC/guards + audit

  * DependsOn: I851
  * Labels: v0.7.1,epic:E85,incidents,api,security
* I853 (E85.3): Incident Detail + Timeline binding (show related events)

  * DependsOn: I852
  * Labels: v0.7.1,epic:E85,incidents,timeline,ui
* I854 (E85.4): Tests + stage smoke runbook (create/list/detail)

  * DependsOn: I851,I852,I853
  * Labels: v0.7.1,epic:E85,tests,runbook

---

## EPIC E86 — Timeline Semantik v1 v0.7.1: Taxonomie + Filter + Konsistenz

* I861 (E86.1): Event Taxonomy v1 (types, actors, correlationId/requestId, entity refs)

  * DependsOn: v0.6 E65.1
  * Labels: v0.7.1,epic:E86,timeline,concepts,docs
* I862 (E86.2): UI Filter (type/entity) + deterministic sorting (tie-breakers)

  * DependsOn: I861
  * Labels: v0.7.1,epic:E86,timeline,ui,determinism
* I863 (E86.3): Tests (ordering, filters, empty states)

  * DependsOn: I862
  * Labels: v0.7.1,epic:E86,tests

---

## EPIC E87 — MCP Tools Transparenz v0.7.1: Inventory + Health + Integration Stand

* I871 (E87.1): Inventory API: list servers/tools + status/versions (no secrets) + bounds

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E87,mcp,tools,observability,security
* I872 (E87.2): UI Page: Tools Inventory (server cards + tool list; deterministic)

  * DependsOn: I871
  * Labels: v0.7.1,epic:E87,mcp,ui,transparency
* I873 (E87.3): Docs/Runbook: “How to verify MCP tools” (stage)

  * DependsOn: I872
  * Labels: v0.7.1,epic:E87,docs,runbook

---

## EPIC E88 — Endpoint Catalog v0.7.1: Übersicht + “Concept Coverage”

* I881 (E88.1): Endpoint Inventory Generator (method/path/tags/guards/owner) deterministic

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E88,api,transparency,determinism
* I882 (E88.2): UI Page: Endpoint Catalog + filters + “in concept?” indicator

  * DependsOn: I881
  * Labels: v0.7.1,epic:E88,ui,api
* I883 (E88.3): Docs: Endpoint Catalog index + contribution rules

  * DependsOn: I882
  * Labels: v0.7.1,epic:E88,docs

---

## EPIC E89 — /ops/migrations v0.7.1: Stage/Dev Only + Workflow OIDC Stability

* I891 (E89.1): Stage/Dev allow + Prod/Unknown block (409) (zero DB calls proven)

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E89,ops,migrations,security,guardrails
* I892 (E89.2): Admin diagnostics (/api/whoami) + UI error guidance (fail-closed)

  * DependsOn: I891
  * Labels: v0.7.1,epic:E89,ops,ui,security
* I893 (E89.3): GitHub Action OIDC fix (AWS_ROLE_TO_ASSUME) + artifact/report output

  * DependsOn: I891
  * Labels: v0.7.1,epic:E89,github-actions,aws,oidc
* I894 (E89.4): Tests + runbook: parity check end-to-end (stage/dev)

  * DependsOn: I891,I892,I893
  * Labels: v0.7.1,epic:E89,tests,runbook

---

## EPIC E90 — Docs Hygiene v0.7.1: /docs Struktur + Version-Unterordner + Index

* I901 (E90.1): Define target docs structure (docs/v07 + docs/v071 + concepts/runbooks/merge-evidence)

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E90,docs,hygiene
* I902 (E90.2): Move/normalize docs into structure + update links

  * DependsOn: I901
  * Labels: v0.7.1,epic:E90,docs,repo-hygiene
* I903 (E90.3): Docs index (single entrypoint) + “what belongs in repo root” rule

  * DependsOn: I902
  * Labels: v0.7.1,epic:E90,docs,governance

---

## EPIC E91 — UI Consistency v0.7.1: Designpattern + Minimal-diff Consolidation

* I911 (E91.1): Designpattern doc (PageHeader, Cards, Alerts, Badges, EmptyStates, Layout)

  * DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  * Labels: v0.7.1,epic:E91,ui,design-system,docs
* I912 (E91.2): Apply minimal-diff consistency fixes across INTENT/Issues/Incidents/Ops pages

  * DependsOn: I911
  * Labels: v0.7.1,epic:E91,ui,ux
* I913 (E91.3): Tests/visual smoke checklist (viewport checks + pass/fail criteria)

  * DependsOn: I912
  * Labels: v0.7.1,epic:E91,ui,runbook
