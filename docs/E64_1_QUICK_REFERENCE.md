# E64.1: GitHub Runner Adapter - Quick Reference

## Was wurde implementiert?

Ein vollständiger GitHub Actions Runner Adapter für AFU-9 mit drei Hauptfunktionen:

1. **Dispatch** - GitHub Workflows auslösen (mit Idempotenz)
2. **Poll** - Workflow-Status überwachen
3. **Ingest** - Fertige Runs einsammeln (Jobs, Artifacts, Logs)

## API Endpoints

| Endpoint | Zweck | Request | Response |
|----------|-------|---------|----------|
| `POST /api/integrations/github/runner/dispatch` | Workflow auslösen | `{owner, repo, workflowIdOrFile, ref, correlationId}` | `{runId, runUrl, recordId, isExisting}` |
| `POST /api/integrations/github/runner/poll` | Status abfragen | `{owner, repo, runId}` | `{status, conclusion, normalizedStatus}` |
| `POST /api/integrations/github/runner/ingest` | Ergebnisse einsammeln | `{owner, repo, runId}` | `{summary, jobs, artifacts, logsUrl}` |

## PowerShell Test-Beispiel

```powershell
# 1. Dispatch
$dispatch = Invoke-RestMethod -Uri "http://localhost:3000/api/integrations/github/runner/dispatch" `
    -Method POST -ContentType "application/json" -Body (@{
        owner = "adaefler-art"
        repo = "codefactory-control"
        workflowIdOrFile = "ci.yml"
        ref = "main"
        correlationId = "test-$(Get-Date -Format yyyyMMddHHmmss)"
    } | ConvertTo-Json)

# 2. Poll (wiederholen bis status = completed)
$poll = Invoke-RestMethod -Uri "http://localhost:3000/api/integrations/github/runner/poll" `
    -Method POST -ContentType "application/json" -Body (@{
        owner = "adaefler-art"
        repo = "codefactory-control"
        runId = $dispatch.runId
    } | ConvertTo-Json)

# 3. Ingest
$ingest = Invoke-RestMethod -Uri "http://localhost:3000/api/integrations/github/runner/ingest" `
    -Method POST -ContentType "application/json" -Body (@{
        owner = "adaefler-art"
        repo = "codefactory-control"
        runId = $dispatch.runId
    } | ConvertTo-Json)
```

## Dateien

### Core (3)
- `control-center/src/lib/github-runner/types.ts` - TypeScript Types
- `control-center/src/lib/github-runner/adapter.ts` - Haupt-Logik
- `control-center/src/lib/db/githubRuns.ts` - Datenbank

### API Routes (3)
- `control-center/app/api/integrations/github/runner/dispatch/route.ts`
- `control-center/app/api/integrations/github/runner/poll/route.ts`
- `control-center/app/api/integrations/github/runner/ingest/route.ts`

### Tests (2)
- `control-center/__tests__/lib/github-runner-adapter.test.ts`
- `control-center/__tests__/api/github-runner-routes.test.ts`

### Docs (3)
- `control-center/src/lib/github-runner/README.md` - Detaillierte Usage
- `docs/E64_1_TESTING_GUIDE.md` - Testing mit PowerShell
- `docs/E64_1_IMPLEMENTATION_SUMMARY.md` - Vollständige Zusammenfassung

## Wichtige Features

### Idempotenz
- Gleicher Request (correlationId + workflow) → Gleiche Response
- Kein doppeltes Dispatchen
- Safe Retries

### Status-Mapping
```
GitHub Status       → Internal Status
queued/waiting      → QUEUED
in_progress         → RUNNING
completed + success → SUCCEEDED
completed + failure → FAILED
completed + cancelled → CANCELLED
```

### Robustheit (Code Review Improvements)
- ✅ Retry-Logik (max 3 Versuche)
- ✅ Timestamp-basierte Run-Suche (konkurrenzsicher)
- ✅ Konfigurierbarer Delay (`GITHUB_DISPATCH_DELAY_MS`)
- ✅ Kollisions-resistente Run-IDs

### Security
- ✅ Keine Secrets im Code
- ✅ GitHub App Auth (Installation Token)
- ✅ Input Validation
- ✅ Type-safe

## Environment Variablen (Optional)

```bash
# GitHub App Auth (Production: AWS Secrets Manager)
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----..."

# Dispatch Tuning (optional)
GITHUB_DISPATCH_DELAY_MS=2000          # Default: 2000ms
GITHUB_DISPATCH_MAX_RETRIES=3          # Default: 3
GITHUB_DISPATCH_LOOKUP_PER_PAGE=20     # Default: 20
```

## Datenbank

Nutzt existierende `runs` Table (migration 026):
- `id` - Interne Run-ID
- `issue_id` - correlationId (Issue/Execution ID)
- `playbook_id` - workflowId
- `spec_json` - GitHub Metadaten (owner, repo, ref, githubRunId, runUrl)
- `result_json` - Ingestierte Ergebnisse
- `status` - QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED

## Tests

```bash
# Unit Tests
npm --prefix control-center test -- __tests__/lib/github-runner-adapter.test.ts

# API Tests
npm --prefix control-center test -- __tests__/api/github-runner-routes.test.ts

# Build
npm --prefix control-center run build
```

## Nächste Schritte

### Sofort
1. Code Review → Merge
2. Integration Tests gegen echte GitHub API
3. Monitoring aufsetzen

### Später
1. UI Integration (Issue/Execution Detail Pages)
2. Annotations via Check Runs API
3. Webhook-basierte Updates (statt Polling)
4. Rate Limiting Dashboard

## Support

Siehe vollständige Dokumentation:
- **README**: `control-center/src/lib/github-runner/README.md`
- **Testing Guide**: `docs/E64_1_TESTING_GUIDE.md`
- **Implementation Summary**: `docs/E64_1_IMPLEMENTATION_SUMMARY.md`
