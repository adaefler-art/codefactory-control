# Staging Migration Check Endpoint

This repo exposes an ops endpoint that reports whether the staging database is in migration parity with the repository, and whether required tables exist.

## Endpoint

- Canonical: `GET /api/ops/db/migrations`
- Alias: `GET /api/ops/db/migration-parity`

### Guard order (fail-closed)

1. `401` unauthenticated
2. `409` deployment-env gate (endpoint only enabled where allowed)
3. `403` not admin
4. DB checks

## Status codes

- `200` OK: returns parity report (PASS/FAIL)
- `400` Unsupported ledger schema: `MIGRATION_LEDGER_UNSUPPORTED_SCHEMA`
- `401` Unauthorized: `UNAUTHORIZED`
- `403` Forbidden (admin-gated): `FORBIDDEN`
- `409` Disabled in prod/unknown env: `ENV_DISABLED`
- `500` DB unreachable: `DB_UNREACHABLE`
- `500` Ledger missing: `MIGRATION_LEDGER_MISSING`

## Response (high level)

The response is deterministic (stable sorting) and includes:

- `repoMigrationFiles`: migration filenames found in the repo
- `dbAppliedMigrations`: applied migration identifiers from the DB ledger
- `missingInDb`: repo migrations not applied in DB
- `extraInDb`: DB-applied migrations not present in repo
- `requiredTablesCheck.requiredTables`: tables that must exist
- `requiredTablesCheck.missingTables`: required tables missing in DB
- `parity`: structured parity details (also includes `missingInDb` / `extraInDb`)
- `requestId`: taken from `x-request-id`
- `deploymentEnv`: resolved deployment environment string
- `lawbookHash`: best-effort hash (if available)

## PowerShell example

This example assumes you’re already authenticated to staging (e.g., via your normal staging proxy / session). It requests JSON and prints it.

```powershell
$baseUrl = "https://<your-staging-host>"
$requestId = [guid]::NewGuid().ToString()

Invoke-RestMethod `
  -Method Get `
  -Uri "$baseUrl/api/ops/db/migrations" `
  -Headers @{ "x-request-id" = $requestId } |
  ConvertTo-Json -Depth 20
```

If you need the alias route:

```powershell
Invoke-RestMethod -Method Get -Uri "$baseUrl/api/ops/db/migration-parity" -Headers @{ "x-request-id" = $requestId } |
  ConvertTo-Json -Depth 20
```

## Example response (sanitized)

```json
{
  "version": "0.7.0",
  "generatedAt": "2026-01-11T06:00:00.000Z",
  "requestId": "<guid>",
  "deploymentEnv": "staging",
  "lawbookVersion": "v0.7.0",
  "lawbookHash": "<hash>",
  "db": { "reachable": true, "host": "<redacted>", "port": 5432, "database": "afu9" },
  "repo": { "migrationCount": 123, "latest": "123_some_migration.sql" },
  "ledger": { "table": "schema_migrations", "appliedCount": 122, "lastApplied": "122_prev.sql", "lastAppliedAt": "2026-01-11T05:55:00.000Z" },
  "parity": {
    "status": "FAIL",
    "missingInDb": ["123_some_migration.sql"],
    "extraInDb": [],
    "hashMismatches": []
  },
  "requiredTablesCheck": {
    "requiredTables": ["intent_issue_drafts", "intent_issue_sets"],
    "missingTables": []
  },
  "repoMigrationFiles": ["..."],
  "dbAppliedMigrations": ["..."],
  "missingInDb": ["123_some_migration.sql"],
  "extraInDb": []
}
```

## PR description snippet

Paste this into the PR body:

```markdown
### Staging Migration Check

- Endpoint: `GET /api/ops/db/migrations` (alias: `/api/ops/db/migration-parity`)
- Status codes: 200/400/401/403/409/500 (see docs)

PowerShell:

```powershell
$baseUrl = "https://<your-staging-host>"
$requestId = [guid]::NewGuid().ToString()
Invoke-RestMethod -Method Get -Uri "$baseUrl/api/ops/db/migrations" -Headers @{ "x-request-id" = $requestId } |
  ConvertTo-Json -Depth 20
```

Sample response: see `docs/STAGING_MIGRATION_CHECK.md`.
```
