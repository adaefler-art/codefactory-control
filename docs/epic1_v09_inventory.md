# Epic-1 v0.9 Inventory: codefactory-control

**Repo:** `adaefler-art/codefactory-control`  
**Datum:** 2026-01-25  
**Zweck:** Evidence-first Bestandsaufnahme für Epic-1 v0.9 "3-State Durchlauf"

---

## Issues: List + Detail

### ✅ Issues List
**Route:** `GET /api/afu9/issues`  
**Datei:** `control-center/app/api/afu9/issues/route.ts`  
**Features:**
- Canonical Single Source of Truth für Issues
- Query-Parameter Support:
  - `canonicalId` / `canonical_id`
  - `publicId` / `public_id`
  - `status` (validated gegen `Afu9IssueStatus` enum)
  - `handoff_state` (validated gegen `Afu9HandoffState` enum)
  - `limit` (default: 100, max: 100)
  - `offset` (default: 0)
- DB-Level Filtering (keine Post-Query-Filterung)
- Response: `{ issues, total, filtered, limit, offset }`

**Fundstelle:** `control-center/app/api/afu9/issues/route.ts` (L1-153)

---

### ❌ Issues Detail (KRITISCH: FEHLT)
**Erwarteter Endpoint:** `GET /api/afu9/issues/:ref`  
**Status:** **NICHT VORHANDEN**

**Problem:**
- Engine (`codefactory-engine`) versucht, `GET /api/afu9/issues/:issueId` zu fetchen
- Control-Center hat nur `/api/afu9/issues` (list), NICHT `/api/afu9/issues/[ref]` (detail)
- Engine muss auf **List-Matching-Fallback** zurückfallen (ineffizient)

**Lösung:**
- Implementiere `control-center/app/api/afu9/issues/[ref]/route.ts`
- Nutze vorhandene `fetchIssueRowByIdentifier()` Logik aus `/api/issues/_shared.ts`
- Unterstütze UUID v4, publicId (8-hex), canonicalId

**Verwandte Endpoints (zum Vergleich):**
- ✅ `GET /api/issues/:id` existiert (control-center/app/api/issues/[id]/route.ts)
- ✅ Nutzt `fetchIssueRowByIdentifier()` für UUID/publicId Lookup
- ✅ Nutzt `getAfu9IssueByCanonicalId()` für canonicalId Fallback

**Fundstellen:**
- Shared Logic: `control-center/app/api/issues/_shared.ts` (L91-142)
- Identifier Parsing: `control-center/src/lib/contracts/afu9Issue.ts`
- DB Functions:
  - `getAfu9IssueById()` — `control-center/src/lib/db/afu9Issues.ts` (L173-200)
  - `getAfu9IssueByPublicId()` — `control-center/src/lib/db/afu9Issues.ts` (L225-256)
  - `getAfu9IssueByCanonicalId()` — `control-center/src/lib/db/afu9Issues.ts` (L1180-1198)

---

## Runs: List + Detail + Create/Start

### ❌ Runs List
**Status:** NICHT VORHANDEN  
**Erwarteter Endpoint:** `GET /api/afu9/runs` oder `GET /api/afu9/issues/:issueId/runs`  
**Findings:** Keine Implementierung gefunden

**Verwandte (aber NICHT Runs List):**
- ⚠️ Loop Execution: `POST /api/loop/issues/:issueId/run-next-step` (siehe unten)
- ⚠️ Runner Service hat `listRunsByIssue()` in DAO, aber kein API-Endpoint

---

### ❌ Runs Detail
**Status:** NICHT VORHANDEN  
**Erwarteter Endpoint:** `GET /api/afu9/runs/:runId`  
**Findings:** Keine Implementierung gefunden

---

### ⚠️ Loop Execution (NICHT Runs Create/Start)
**Route:** `POST /api/loop/issues/:issueId/run-next-step`  
**Datei:** `control-center/app/api/loop/issues/[issueId]/run-next-step/route.ts`  
**Typ:** E9.1 Loop Executor (KEIN generischer Run Create/Start)

**Features:**
- Request: `{ mode?: "execute" | "dryRun" }`
- Response: `RunNextStepResponse` mit state transitions
- Contract: E9.1-CTRL-1 (schemaVersion, requestId, execution details)
- Errors: 401, 404, 409 (lock conflict), 500

**WICHTIG:**
- Dies ist **NICHT** ein generischer Runs-Endpoint
- Führt **spezifische Loop-Steps** aus (S1 → S2 → S3)
- Nutzt Runner Service intern, aber keine öffentliche Runs API

**Fundstelle:** `control-center/app/api/loop/issues/[issueId]/run-next-step/route.ts` (L1-27)

---

## Runner/Execution: State Machine + Persistence

### ✅ Runner Service
**Datei:** `control-center/src/lib/runner-service.ts`  
**Features:**
- Playbook Management (in-memory, future: S3/DynamoDB)
- Run Execution mit DB Persistence
- State Transitions: `QUEUED` → `RUNNING` → `SUCCEEDED`/`FAILED`
- Idempotent Execution (nur QUEUED runs können executed werden)

**Key Methods:**
- `listPlaybooks()` — Liste verfügbare Playbooks
- `createRun(spec, issueId?, playbookId?)` — Erstelle Run in DB
- `executeRun(runId)` — Führe Run aus (mit idempotency check)

**Fundstelle:** `control-center/src/lib/runner-service.ts` (L1-34, L201-224)

---

### ✅ Runs DAO
**Datei:** `mcp-servers/afu9-runner/src/adapters/runs-dao.ts`  
**Features:**
- `createRun()` — Insert run + steps (status: QUEUED)
- `getRun()` — Get run + steps by runId
- `updateRunStatus()` — Transition run status
- `updateStep()` — Update step status + results
- `listRunsByIssue()` — Get runs for issue (limit/offset)
- `getRunSteps()` — Get steps for run
- `reconstructRunResult()` — Build RunResult from DB

**Status Mapping (DB → Contract):**
- `QUEUED` → `created`
- `RUNNING` → `running`
- `SUCCEEDED` → `success`
- `FAILED` → `failed`
- `CANCELLED` → `cancelled`

**Step Status Mapping:**
- `QUEUED` → `pending`
- `RUNNING` → `running`
- `SUCCEEDED` → `success`
- `FAILED` → `failed`
- `SKIPPED` → `skipped`

**Fundstelle:** `mcp-servers/afu9-runner/src/adapters/runs-dao.ts` (L1-329)

---

### ✅ State Machine (Documented)
**Datei:** `docs/mcp/servers/afu9-runner.md`  
**Run Status Transitions:**
```
created → running → success
                 ↘ failed
                 ↘ timeout
                 ↘ cancelled
```

**Step Status Transitions:**
```
pending → running → success
                 ↘ failed
                 ↘ timeout
                 ↘ skipped
```

**Constraints:**
- Cannot execute a run not in `created` status
- Cannot transition from terminal states

**Fundstelle:** `docs/mcp/servers/afu9-runner.md` (L302-343)

---

### ✅ Database Schema
**Tables:**
1. `runs` — Run metadata (id, issue_id, title, status, spec_json, timestamps)
2. `run_steps` — Step execution (run_id, idx, name, status, exit_code, duration_ms, stdout_tail, stderr_tail)
3. `run_artifacts` — Artifacts (run_id, step_idx, kind, name, ref, bytes, sha256)

**Fundstellen:**
- Migration Scripts: `control-center/migrations/` (SQL files)
- DAO Usage: `mcp-servers/afu9-runner/src/adapters/runs-dao.ts`

---

## API Routes Manifest

**Datei:** `control-center/src/lib/api-routes.ts`  
**Relevante Routes für Epic-1:**

### Issues
- `issues.list: '/api/issues'`
- `issues.detail: (id) => '/api/issues/${id}'`
- `issues.activate: (id) => '/api/issues/${id}/activate'`
- `issues.handoff: (id) => '/api/issues/${id}/handoff'`
- `issues.runs: (id) => '/api/issues/${id}/runs'`

### AFU-9 Specific
- `afu9.runs.start: (issueId) => '/api/afu9/issues/${issueId}/runs/start'`
- `afu9.runs.evidenceRefresh: (runId) => '/api/afu9/runs/${runId}/evidence/refresh'`

**WICHTIG:**
- Diese Routes sind **deklariert**, aber **NICHT alle implementiert**
- Nur Loop Execution (`/api/loop/issues/:issueId/run-next-step`) existiert

**Fundstelle:** `control-center/src/lib/api-routes.ts` (L93-113)

---

## Integration mit Engine

### ✅ Service Token Auth
**Environment Variable:** `CONTROL_CENTER_SERVICE_TOKEN`  
**Header:** `x-afu9-service-token`

**Verwendung:**
- Engine sendet Service Token in allen Requests zu control-center
- Control-Center validiert Token (wenn gesetzt)

**Fundstellen:**
- Engine Request: `packages/engine/src/api/issuesHandlers.ts`
- Control-Center Validation: (implizit, kein expliziter Auth-Handler gefunden)

---

## Zusammenfassung

| Feature | Status | Implementiert? |
|---------|--------|----------------|
| Issues List | ✅ Vorhanden | `/api/afu9/issues` |
| Issues Detail | ❌ **FEHLT** | `/api/afu9/issues/[ref]` NICHT vorhanden |
| Runs List | ❌ Nicht vorhanden | — |
| Runs Detail | ❌ Nicht vorhanden | — |
| Runs Create/Start | ❌ Nicht vorhanden | Loop Execution ≠ Runs API |
| Runner Service | ✅ Vorhanden | `runner-service.ts` |
| Runs DAO | ✅ Vorhanden | `runs-dao.ts` |
| State Machine | ✅ Dokumentiert | `QUEUED → RUNNING → SUCCEEDED/FAILED` |
| Run Persistence | ✅ Vorhanden | `runs`, `run_steps`, `run_artifacts` Tabellen |
| Loop Execution | ✅ Vorhanden | `/api/loop/issues/:issueId/run-next-step` |

---

## Epic-1 v0.9 Findings

### ❌ KRITISCH: Issue Detail Endpoint fehlt
- Engine erwartet `/api/afu9/issues/:ref`
- Control-Center hat nur `/api/afu9/issues` (list)
- **Fix erforderlich:** Implementiere `/api/afu9/issues/[ref]/route.ts`

### ✅ Runner Infrastructure vorhanden
- State Machine implementiert (RunnerService + RunsDAO)
- Persistence funktioniert (`runs`, `run_steps` Tabellen)
- Loop Execution nutzt Runner Service

### ⚠️ Runs API fehlt (aber nicht Epic-1 Scope)
- Keine öffentliche Runs List/Detail API
- UI zeigt korrekt disabled Buttons
- Loop Execution ist separates Feature

---

## Nächste Schritte (Epic-1 v0.9)

1. **KRITISCH:** Implementiere `/api/afu9/issues/[ref]/route.ts` (siehe separate PR)
2. **Optional:** Dokumentiere Loop Execution als eigenständiges Feature
3. **Future:** Implementiere generische Runs API (nicht Epic-1 Scope)

---

**Dokument-Version:** 1.0  
**Erstellt am:** 2026-01-25  
**Epic:** Epic-1 v0.9 "3-State Durchlauf"
