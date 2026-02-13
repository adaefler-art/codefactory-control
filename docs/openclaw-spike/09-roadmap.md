# AFU-9 Roadmap mit Go/No-Go Gates

## Phase 0 - Alignment + Guardrail Baseline

Goals:
- Risikoanalyse als Single Source of Truth verankern.
- Guardrail Policy in Doku festschreiben.

Deliverables:
- 08-risk-analysis.md final.
- Guardrail Non-Negotiables dokumentiert.

Gates:
- None (informational only).

## Phase 1 - Adopt now: Guardrails Preflight + Audit Snapshot

Goals:
- Deterministische Guardrail Preflight Checks fuer risky operations.
- Audit Snapshot API (read-only).

Deliverables:
- `POST /api/afu9/guardrails/preflight`
- `GET /api/afu9/guardrails/audit`
- Deterministische Audit Headers.

Gates:
- Phase 1 ist erlaubt jetzt. (ref: 08-risk-analysis.md, 07-poc-plan.md)

## Phase 2 - Manifest + Capability Gating (Skills Snapshot Prep)

Goals:
- Minimaler Skill Manifest + Validator.
- Capability allowlist + approvals.

Deliverables:
- Manifest schema v0.
- Capability model (allowlist + approval).

Gates:
- Skills snapshotting erst nach Manifest + Capability Gating. (ref: 08-risk-analysis.md)
- Signing/hash pinning requirements definiert. (ref: 08-risk-analysis.md)

## Phase 3 - Skills Snapshot + Watcher (Adopt later)

Goals:
- Snapshot/Watcher fuer Skill Prompt Assembly.

Deliverables:
- Skills snapshotting pipeline.
- Skill reload policy.

Gates:
- Manifest schema + validator vorhanden. (ref: 08-risk-analysis.md)
- Capability allowlist + approvals aktiv. (ref: 08-risk-analysis.md)
- Audit headers in skill execution path. (ref: 08-risk-analysis.md)

## Phase 4 - Plugin Registry (Conditional)

Goals:
- Registry fuer optionale Plugins, nur wenn notwendig.

Deliverables:
- Plugin registry v0.
- Publisher allowlist.

Gates:
- Signing + hash pinning enforced. (ref: 08-risk-analysis.md)
- Runtime isolation (worker/container) definiert. (ref: 08-risk-analysis.md)
- Capability approvals + audit headers vorhanden. (ref: 08-risk-analysis.md)

## Phase 5 - Optional Extensions (Memory/State)

Goals:
- Optional memory/state Konzepte evaluieren.

Deliverables:
- Decision memo (adopt later / do not adopt).

Gates:
- Guardrails unveraendert stabil. (ref: 08-risk-analysis.md)

## Non-Goals

- Kein OpenClaw Gateway/WS plane.
- Kein Vendoring von OpenClaw Code.
- Keine in-process arbitrary plugins.
