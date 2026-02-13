# AFU-9 PoC Plan - Security Audit Guardrails (Minimal)

## Kandidat

Aus [docs/openclaw-spike/02-mapping-table.md](docs/openclaw-spike/02-mapping-table.md): "Security audit + hardening" (Reuse Potential: High, Integration Risk: Security Low). Fokus: AFU-9 Guardrail Preflight + Audit Snapshots.

## Scope

Was wird gebaut:
- Minimaler Guardrail-Preflight fuer AFU-9 (Policy Checks + deterministische Error Codes).
- Audit Snapshot im Control Center (read-only, keine automatische Fixes).
- Standardisierte Headers fuer Guardrail Responses.

Was explizit nicht gebaut wird:
- Keine OpenClaw-Integration, kein Code-Vendoring.
- Kein Skill Registry System, kein Plugin Loader.
- Kein vollstaendiges Sandbox/Runtime Isolation Framework.
- Kein UI fuer Guardrails (nur API + Doku + Tests).

## API Contracts

### Endpoint: Guardrail Preflight

- Route: `POST /api/afu9/guardrails/preflight`
- Purpose: Policy Checks fuer risky operations (repo-write, external egress, privileged tokens).
- Request body (JSON):
  - `requestId` (string, optional)
  - `operation` (string; z. B. `repo_write`, `issue_mutation`, `skill_execute`)
  - `repo` (string, optional; `owner/name`)
  - `actor` (string, optional)
  - `capabilities` (string[], optional)
  - `requiresConfig` (string[], optional) - deklarierte config keys

- Response headers (immer gesetzt):
  - `x-afu9-request-id`
  - `x-afu9-handler`
  - `x-afu9-phase=preflight`
  - `x-afu9-missing-config` (csv oder leer)

- Success response (200):
  - `{ ok: true, allowed: true, requestId, policyVersion, checks: [...] }`

- Blocked response (409):
  - `{ ok: false, allowed: false, code, requestId, missingConfig?, preconditionFailed?, detailsSafe? }`
  - Codes: `GUARDRAIL_REPO_NOT_ALLOWED`, `GUARDRAIL_TOKEN_SCOPE_INVALID`, `GUARDRAIL_CONFIG_MISSING`.

### Endpoint: Audit Snapshot (read-only)

- Route: `GET /api/afu9/guardrails/audit`
- Response headers:
  - `x-afu9-request-id`
  - `x-afu9-handler`

- Response body:
  - `{ ok: true, ts, summary: { critical, warn, info }, findings: [...] }`

## Data model additions

Minimal: keine neuen DB Tabellen. Audit snapshot kann live berechnet werden.
Optional (wenn persisted):
- `guardrail_audit_snapshots` mit `id`, `ts`, `summary`, `findings_json`.

## Test Plan

Unit:
- Policy evaluator returns correct code per missing config / allowlist block.
- Header normalization ensures `x-afu9-phase` and `x-afu9-missing-config`.

Integration:
- Preflight endpoint returns 409 when repo not allowlisted.
- Preflight endpoint returns 409 when required env missing.
- Audit endpoint returns summary schema.

## Rollback Strategy

- Feature flag via env: `AFU9_GUARDRAILS_ENABLED=false` returns 204 no-op.
- Delete new routes and revert to previous handler behavior.
- No schema migrations required in minimal path.

## GitHub Issues (max 8)

1) **AFU-9 Guardrails: preflight endpoint stub**
   - Acceptance: `POST /api/afu9/guardrails/preflight` returns 200 with headers set.

2) **AFU-9 Guardrails: repo allowlist gate**
   - Acceptance: repo not in allowlist => 409 `GUARDRAIL_REPO_NOT_ALLOWED` + headers.

3) **AFU-9 Guardrails: config/env missing gate**
   - Acceptance: missing required config => 409 `GUARDRAIL_CONFIG_MISSING` + `x-afu9-missing-config`.

4) **AFU-9 Guardrails: token scope gate**
   - Acceptance: token scope policy violation => 409 `GUARDRAIL_TOKEN_SCOPE_INVALID`.

5) **AFU-9 Guardrails: audit snapshot endpoint**
   - Acceptance: `GET /api/afu9/guardrails/audit` returns summary + findings schema.

6) **AFU-9 Guardrails: policy evaluator unit tests**
   - Acceptance: unit tests cover all error codes + headers.

7) **AFU-9 Guardrails: integration tests (preflight/audit)**
   - Acceptance: integration tests pass for 200/409 scenarios.

8) **AFU-9 Guardrails: docs + runbook**
   - Acceptance: docs describe policy checks, error codes, and expected headers.
