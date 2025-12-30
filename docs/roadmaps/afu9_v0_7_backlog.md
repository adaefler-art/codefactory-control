# AFU-9 Backlog v0.7 (Import)

## META
- Release: v0.7
- Gate (must be DONE before any v0.7 work):
  - v0.6: E64.1 → E64.2 → E65.2 → E65.1
- Scope Principle: Steering Loop MVP (Observe→Diagnose→Verdict→Act→Verify→Learn)
- Out of scope (v0.8+): Issue→PR Automation / PR Autogen
- Non-Negotiables:
  - GitHub Auth: GitHub App server-to-server (JWT → Installation Token), no OAuth
  - Determinism/Evidence: every step produces evidence; no trial-and-error without logs
  - Idempotency everywhere (dispatch, issue create/update, remediation)
  - Lawbook/Guardrails transparent + versioned; lawbookVersion included in all artifacts
  - PowerShell for CLI snippets; default Copilot prompts for build/debug/impl

---

## EPIC E71 — Evidence Layer: Repo Read-Only (GitHub App)
- I711 (E71.1): Repo Access Policy (Allowlist owner/repo/branch) + server-side Auth Wrapper
  - DependsOn: v0.6 E64.1,E64.2,E65.2,E65.1
  - Labels: v0.7,epic:E71,layer:A,evidence,security,github-app
- I712 (E71.2): Tool listTree (branch/path, pagination, deterministic ordering)
  - DependsOn: I711
  - Labels: v0.7,epic:E71,layer:A,evidence,github-app
- I713 (E71.3): Tool readFile (line ranges + snippet-hash, size limits, caching)
  - DependsOn: I711
  - Labels: v0.7,epic:E71,layer:A,evidence,github-app
- I714 (E71.4): Tool searchCode (query constraints, rate-limit, result hashing, caching)
  - DependsOn: I711
  - Labels: v0.7,epic:E71,layer:A,evidence,github-app

---

## EPIC E72 — Product Memory: Historie + Artefakte → Timeline/Graph
- I721 (E72.1): Timeline/Linkage Model (Issue/PR/Run/Deploy/Verdict/Artifact + Links)
  - DependsOn: v0.6 E64.1,E65.1
  - Labels: v0.7,epic:E72,layer:A,memory,data-model
- I722 (E72.2): GitHub Ingestion (Issues/PRs/Comments/Labels) → normalized + idempotent
  - DependsOn: I721
  - Labels: v0.7,epic:E72,layer:A,memory,github
- I723 (E72.3): AFU-9 Ingestion (Runs/Verdicts/Deploy Events/Test Runs) → normalized + idempotent
  - DependsOn: I721
  - Labels: v0.7,epic:E72,layer:A,memory,afu9
- I724 (E72.4): Query API “Chain for Issue” + minimal UI node view
  - DependsOn: I722,I723
  - Labels: v0.7,epic:E72,layer:A,memory,ui

---

## EPIC E73 — INTENT Console MVP: Chat + Sources + Context Pack
- I731 (E73.1): INTENT Console UI Shell (sessions, persistence, minimal chat)
  - DependsOn: I721
  - Labels: v0.7,epic:E73,layer:B,intent,ui
- I732 (E73.2): Sources Panel + used_sources Contract (file refs, issue/pr refs, hashes)
  - DependsOn: I731,I712,I713,I714
  - Labels: v0.7,epic:E73,layer:B,intent,evidence
- I733 (E73.3): Context Pack Generator (audit JSON per session) + Export/Download
  - DependsOn: I732
  - Labels: v0.7,epic:E73,layer:B,intent,evidence,audit
- I734 (E73.4): Context Pack Storage/Retrieval (versioning, immutable snapshots)
  - DependsOn: I733
  - Labels: v0.7,epic:E73,layer:B,intent,audit,storage

---

## EPIC E74 — ChangeRequest (CR): Schema + Validator + Preview/Edit
- I741 (E74.1): CR JSON Schema v1 (CanonicalID, Scope, AC, Tests, Risks, Evidence, Rollout)
  - DependsOn: I733
  - Labels: v0.7,epic:E74,layer:B,cr,schema
- I742 (E74.2): Validator Library + Standard Error Format (UI/CI usable)
  - DependsOn: I741
  - Labels: v0.7,epic:E74,layer:B,cr,validation
- I743 (E74.3): UI: CR Preview/Edit (Form/JSON) + Validation Gate (min 1 evidence)
  - DependsOn: I742
  - Labels: v0.7,epic:E74,layer:B,cr,ui
- I744 (E74.4): CR Versioning + Diff (immutable versions + latest pointer)
  - DependsOn: I741
  - Labels: v0.7,epic:E74,layer:B,cr,audit

---

## EPIC E75 — CR → GitHub Issue Generator (Idempotent)
- I751 (E75.1): Canonical-ID Resolver (find/update existing issue; no duplicates)
  - DependsOn: I741,I722
  - Labels: v0.7,epic:E75,layer:B,github,idempotency
- I752 (E75.2): Create/Update Issue via GitHub App (labels, canonical state init, body template)
  - DependsOn: I751
  - Labels: v0.7,epic:E75,layer:B,github,workflow
- I753 (E75.3): Idempotency + Concurrency Tests (same CR repeatedly → same issue updated)
  - DependsOn: I752
  - Labels: v0.7,epic:E75,layer:B,tests,idempotency
- I754 (E75.4): Audit Trail (CR↔Issue mapping, hashes, timestamps, lawbookVersion)
  - DependsOn: I752,I791
  - Labels: v0.7,epic:E75,layer:B,audit,lawbook

---

## EPIC E76 — Self-Debugging: Incident Records + Classification
- I761 (E76.1): Incident Schema + DB Tables (source, evidence, classification, status)
  - DependsOn: v0.6 E65.1,E65.2
  - Labels: v0.7,epic:E76,layer:C,incidents,data-model
- I762 (E76.2): Incident Ingest (Runner/Verification/Deploy-Status/ECS Events) idempotent
  - DependsOn: I761
  - Labels: v0.7,epic:E76,layer:C,incidents,ingest,evidence
- I763 (E76.3): Classifier v1 (rule-based labels + evidence pack; deterministic)
  - DependsOn: I762
  - Labels: v0.7,epic:E76,layer:C,incidents,classification
- I764 (E76.4): UI: Incidents Tab + linking (Issue↔Incident↔Timeline↔Evidence)
  - DependsOn: I763,I724
  - Labels: v0.7,epic:E76,layer:C,incidents,ui

---

## EPIC E79 — Lawbook/Guardrails: Transparency + Versioning (MVP)
- I791 (E79.1): Lawbook Schema + Versioning (immutable versions + active pointer)
  - DependsOn: v0.6 E64.2,E65.2
  - Labels: v0.7,epic:E79,layer:C,lawbook,governance
- I792 (E79.2): Admin UI Editor (edit→validate→publish new version) + diff view
  - DependsOn: I791
  - Labels: v0.7,epic:E79,layer:C,lawbook,ui
- I793 (E79.3): Enforce lawbookVersion in all Verdicts/Reports/Incidents
  - DependsOn: I791,I761
  - Labels: v0.7,epic:E79,layer:C,lawbook,enforcement
- I794 (E79.4): Guardrail Gates Library (shared determinism/evidence/idempotency policies)
  - DependsOn: I791
  - Labels: v0.7,epic:E79,layer:C,lawbook,guards

---

## EPIC E77 — Self-Healing: Remediation Playbooks (Controlled)
- I771 (E77.1): Playbook Framework (idempotency keys, evidence gating, lawbook gates)
  - DependsOn: I794,I761
  - Labels: v0.7,epic:E77,layer:C,healing,playbooks
- I772 (E77.2): Playbook “Safe Retry” (Runner reuse) + “Re-run Verification” (E65.2 reuse)
  - DependsOn: I771
  - Labels: v0.7,epic:E77,layer:C,healing,playbooks
- I773 (E77.3): Playbook “Redeploy Last Known Good” + Verify + Status update
  - DependsOn: I771,I723
  - Labels: v0.7,epic:E77,layer:C,healing,playbooks
- I774 (E77.4): Playbook “Service Health Reset” (safe scale/bounce) + Verify
  - DependsOn: I771
  - Labels: v0.7,epic:E77,layer:C,healing,playbooks
- I775 (E77.5): Full Audit Trail for Remediation (actions/inputs/evidence/results/lawbookVersion)
  - DependsOn: I771,I793
  - Labels: v0.7,epic:E77,layer:C,healing,audit

---

## EPIC E78 — Self-Optimization: Outcomes, KPIs, Postmortems, Tuning Suggestions
- I781 (E78.1): KPI Store + Compute (D2D/HSH/DCU/AVS + IncidentRate/MTTR/AutoFixRate)
  - DependsOn: I761
  - Labels: v0.7,epic:E78,layer:C,metrics,optimization
- I782 (E78.2): Outcome Records + Auto-Postmortem JSON (evidence-based)
  - DependsOn: I781,I775
  - Labels: v0.7,epic:E78,layer:C,metrics,postmortem
- I783 (E78.3): Tuning Suggestions Generator (rules/playbooks) — suggestions only (no auto-apply)
  - DependsOn: I782
  - Labels: v0.7,epic:E78,layer:C,optimization,governance
- I784 (E78.4): Ops Dashboard (trends, top failure classes, playbook effectiveness)
  - DependsOn: I781,I764
  - Labels: v0.7,epic:E78,layer:C,metrics,ui
