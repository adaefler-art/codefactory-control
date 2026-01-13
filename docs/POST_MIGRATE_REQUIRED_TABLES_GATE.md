# Post-migrate Required Tables Gate (Deploy Fail-Closed)

Goal: Make staging deploys fail (red) immediately after DB migrations if required tables are missing (e.g. `public.intent_issue_authoring_events`).

## How it works

- Deploy workflow calls the existing staging-only endpoint:
  - `GET https://stage.afu-9.com/api/ops/db/migrations?limit=200&env=staging`
- Auth uses the existing staging smoke mechanism (`x-afu9-smoke-key`) resolved from AWS Secrets Manager (`afu9/stage/smoke-key`).
- The gate **always runs on every staging deploy**, even when migrations are skipped (`should_migrate=false`), to catch schema drift early and fail the deploy before post-deploy steps.
- The workflow fails if:
  - `requiredTablesCheck.status != "PASS"`, or
  - `requiredTablesCheck.missingTables.length > 0` (prints up to 50 entries).

## Why gate runs independent of should_migrate

The gate is **decoupled from the migration decision** to ensure schema validation happens regardless:
- If migrations run: gate validates the result
- If migrations skip: gate still validates current schema (catches drift via manual DB changes or other deployments)
- Staging environment benefits from constant validation to prevent stale schema state

## Verify remotely (PowerShell)

This mirrors the workflow behavior (no VPN required):

```powershell
# 1) Resolve smoke key (requires AWS creds that can read the secret)
$smokeKey = (aws secretsmanager get-secret-value --region eu-central-1 --secret-id "afu9/stage/smoke-key" --query SecretString --output text).Trim()

# 2) Call the endpoint
$uri = "https://stage.afu-9.com/api/ops/db/migrations?limit=200&env=staging"
$r = Invoke-RestMethod -Method Get -Uri $uri -Headers @{
  'x-afu9-smoke-key' = $smokeKey
  'x-afu9-sub'       = 'manual-required-tables-gate'
}

# 3) Deterministic gate
"requestId=$($r.requestId) deploymentEnv=$($r.deploymentEnv) lawbookHash=$($r.lawbookHash)"
if ($r.requiredTablesCheck.status -ne 'PASS') { throw "Gate FAIL: status=$($r.requiredTablesCheck.status)" }
if (@($r.requiredTablesCheck.missingTables).Count -gt 0) { throw ("Gate FAIL: missing=" + ((@($r.requiredTablesCheck.missingTables) | Select-Object -First 50) -join ', ')) }
"Gate PASS"
```

## Verify in CI

- Trigger a staging deploy (`DEPLOY_ENV=staging`) and ensure the step **Post-migrate Required Tables Gate** runs **every time**.
- If `public.intent_issue_authoring_events` is missing, the deploy job fails before post-deploy success/verify steps.
- Gate logs include `migrationsSkipped=true/false` to track whether migrations were executed.
